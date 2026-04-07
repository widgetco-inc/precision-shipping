import { shopifyGraphql } from '../shopify';
import { shopifyWeightToGrams } from './catalog';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VariantWeightRecord {
  variantId: string; // bare numeric string, e.g. "1234567890"
  sku: string;
  productTitle: string;
  variantTitle: string;
  shopifyCatalogGrams: number; // Shopify's own rounded catalog weight
  metafieldGrams: number | null; // our true weight (null = not set)
  status: 'ok' | 'missing' | 'mismatch';
}

export interface SyncWarning {
  variantId: string;
  sku: string;
  productTitle: string;
  variantTitle: string;
  status: 'missing' | 'mismatch';
  shopifyCatalogGrams: number;
  metafieldGrams: number | null;
  message: string;
}

export interface SyncResult {
  scannedCount: number;
  okCount: number;
  warnings: SyncWarning[];
  records: VariantWeightRecord[];
  lastRunAt: string;
}

export interface CsvImportResult {
  attempted: number;
  succeeded: number;
  skipped: number;
  errors: Array<{ sku: string; reason: string }>;
}

export interface NightlyAlertResult {
  ranAt: string;
  warnings: SyncWarning[];
}

// ─── Shopify GraphQL response shapes ─────────────────────────────────────────

interface MetafieldNode { value: string; }

interface VariantEdgeNode {
  id: string;
  sku: string;
  weight: number;
  weightUnit: string;
  metafield: MetafieldNode | null;
  product: { title: string };
  displayName: string;
}

interface ProductVariantsResponse {
  data: {
    productVariants: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      edges: Array<{ node: VariantEdgeNode }>;
    };
  };
}

// ─── In-memory state (Railway keeps process alive) ────────────────────────────
let lastSyncResult: SyncResult | null = null;
let syncInProgress = false;
let lastNightlyAlert: NightlyAlertResult | null = null;

export function getLastSyncResult(): SyncResult | null { return lastSyncResult; }
export function isSyncInProgress(): boolean { return syncInProgress; }
export function getLastNightlyAlert(): NightlyAlertResult | null { return lastNightlyAlert; }

// ─── Main scan ───────────────────────────────────────────────────────────────

/**
 * Scans every product variant in Shopify.
 * Returns all records + a warnings list for missing/mismatched metafields.
 * Mismatch threshold: if metafield differs from Shopify catalog weight by > 20%
 * (large discrepancies likely indicate a data entry error on either side).
 */
export async function runWeightSync(): Promise<SyncResult> {
  if (syncInProgress) {
    throw new Error('Sync already in progress');
  }
  syncInProgress = true;

  const records: VariantWeightRecord[] = [];

  try {
    let cursor: string | null = null;
    let hasNext = true;

    while (hasNext) {
      const afterClause = cursor ? `, after: "${cursor}"` : '';
      const query = `
        query listVariants {
          productVariants(first: 250${afterClause}) {
            pageInfo { hasNextPage endCursor }
            edges {
              node {
                id sku weight weightUnit
                displayName
                product { title }
                metafield(namespace: "custom", key: "actual_weight_grams") {
                  value
                }
              }
            }
          }
        }
      `;

      const resp = await shopifyGraphql<ProductVariantsResponse>(query, {});
      const page = resp.data?.productVariants;
      if (!page) break;

      for (const { node } of page.edges) {
        const variantId = node.id.replace('gid://shopify/ProductVariant/', '');
        const shopifyCatalogGrams = shopifyWeightToGrams(node.weight ?? 0, node.weightUnit ?? 'GRAMS');
        const metafieldGrams = node.metafield?.value
          ? parseFloat(node.metafield.value)
          : null;

        let status: VariantWeightRecord['status'] = 'ok';
        if (metafieldGrams === null || isNaN(metafieldGrams as number)) {
          status = 'missing';
        } else if (shopifyCatalogGrams > 0) {
          // Flag if metafield differs from Shopify catalog by more than 20%
          const ratio = (metafieldGrams as number) / shopifyCatalogGrams;
          if (ratio < 0.8 || ratio > 1.2) {
            status = 'mismatch';
          }
        }

        records.push({
          variantId,
          sku: node.sku ?? '',
          productTitle: node.product?.title ?? '',
          variantTitle: node.displayName ?? '',
          shopifyCatalogGrams,
          metafieldGrams: (metafieldGrams !== null && !isNaN(metafieldGrams as number))
            ? (metafieldGrams as number)
            : null,
          status,
        });
      }

      hasNext = page.pageInfo.hasNextPage;
      cursor = page.pageInfo.endCursor;
    }

    const warnings: SyncWarning[] = records
      .filter(r => r.status !== 'ok')
      .map(r => ({
        variantId: r.variantId,
        sku: r.sku,
        productTitle: r.productTitle,
        variantTitle: r.variantTitle,
        status: r.status as 'missing' | 'mismatch',
        shopifyCatalogGrams: r.shopifyCatalogGrams,
        metafieldGrams: r.metafieldGrams,
        message: r.status === 'missing'
          ? `No true weight set — will fall back to Shopify catalog (${r.shopifyCatalogGrams}g)`
          : `True weight (${r.metafieldGrams}g) differs >20% from Shopify catalog (${r.shopifyCatalogGrams}g) — please verify`,
      }));

    lastSyncResult = {
      scannedCount: records.length,
      okCount: records.filter(r => r.status === 'ok').length,
      warnings,
      records,
      lastRunAt: new Date().toISOString(),
    };

    console.log(`[weightSync] Scanned ${records.length} variants: ${lastSyncResult.okCount} ok, ${warnings.length} warnings`);
    return lastSyncResult;

  } finally {
    syncInProgress = false;
  }
}

// ─── CSV bulk import ──────────────────────────────────────────────────────────

/**
 * Parses a CSV string with columns sku,grams (header row optional).
 * Looks up each SKU in Shopify to find the variant ID, then sets the
 * actual_weight_grams metafield.  Unknown SKUs are reported as errors.
 * Accepts both "sku,grams" and "sku,weight_grams" header variants.
 */
export async function bulkImportFromCsv(csvText: string): Promise<CsvImportResult> {
  const result: CsvImportResult = { attempted: 0, succeeded: 0, skipped: 0, errors: [] };

  // Parse rows
  const rows = csvText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (rows.length === 0) return result;

  // Detect and skip header row
  const firstRow = rows[0].toLowerCase();
  const startIdx = (firstRow.startsWith('sku') || firstRow.startsWith('"sku')) ? 1 : 0;

  const entries: Array<{ sku: string; grams: number }> = [];
  for (let i = startIdx; i < rows.length; i++) {
    const parts = rows[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
    if (parts.length < 2) continue;
    const sku = parts[0];
    const grams = parseFloat(parts[1]);
    if (!sku || isNaN(grams) || grams <= 0) {
      result.errors.push({ sku: sku || '(empty)', reason: `Invalid grams value: ${parts[1]}` });
      result.skipped++;
      continue;
    }
    entries.push({ sku, grams });
  }

  result.attempted = entries.length;
  if (entries.length === 0) return result;

  // Fetch variant IDs for all SKUs in one paginated pass
  const skuToVariantId = await fetchSkuToVariantIdMap(entries.map(e => e.sku));

  // Write each metafield
  for (const { sku, grams } of entries) {
    const variantId = skuToVariantId.get(sku);
    if (!variantId) {
      result.errors.push({ sku, reason: 'SKU not found in Shopify' });
      result.skipped++;
      continue;
    }
    try {
      await setVariantTrueWeight(variantId, grams);
      result.succeeded++;
    } catch (err: any) {
      result.errors.push({ sku, reason: err?.message ?? 'Metafield write failed' });
      result.skipped++;
    }
  }

  console.log(`[weightSync] CSV import: ${result.succeeded}/${result.attempted} succeeded, ${result.skipped} skipped`);
  return result;
}

/**
 * Builds a Map<sku, variantId> by scanning all variants.
 * Only fetches variants whose SKUs are in the requested set.
 */
async function fetchSkuToVariantIdMap(skus: string[]): Promise<Map<string, string>> {
  const skuSet = new Set(skus);
  const map = new Map<string, string>();

  let cursor: string | null = null;
  let hasNext = true;

  while (hasNext) {
    const afterClause = cursor ? `, after: "${cursor}"` : '';
    const query = `
      query listVariantIds {
        productVariants(first: 250${afterClause}) {
          pageInfo { hasNextPage endCursor }
          edges {
            node { id sku }
          }
        }
      }
    `;

    const resp = await shopifyGraphql<{ data: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: Array<{ node: { id: string; sku: string } }> } } }>(query, {});
    const page = resp.data?.productVariants;
    if (!page) break;

    for (const { node } of page.edges) {
      if (node.sku && skuSet.has(node.sku)) {
        map.set(node.sku, node.id.replace('gid://shopify/ProductVariant/', ''));
      }
    }

    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;

    // Stop early if we've found all requested SKUs
    if (map.size === skuSet.size) break;
  }

  return map;
}

// ─── Nightly alert job ────────────────────────────────────────────────────────

/**
 * Runs a weight sync and stores the result as the latest nightly alert.
 * Designed to be called once per night; the stored result is served via
 * GET /api/weights/alerts.
 */
export async function runNightlyAlert(): Promise<NightlyAlertResult> {
  console.log('[weightSync] Running nightly alert sync…');
  try {
    const result = await runWeightSync();
    lastNightlyAlert = {
      ranAt: result.lastRunAt,
      warnings: result.warnings,
    };
    if (result.warnings.length > 0) {
      console.warn(`[weightSync] Nightly alert: ${result.warnings.length} weight issue(s) found`);
    } else {
      console.log('[weightSync] Nightly alert: all weights OK');
    }
    return lastNightlyAlert;
  } catch (err) {
    console.error('[weightSync] Nightly alert sync failed:', err);
    throw err;
  }
}

/**
 * Schedules the nightly sync job to run every day at 02:00 local server time.
 * Call once at app startup.
 */
export function scheduleNightlyAlert(): void {
  function msUntilNextRun(): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  }

  function scheduleNext() {
    const delay = msUntilNextRun();
    console.log(`[weightSync] Next nightly alert scheduled in ${Math.round(delay / 60000)} min`);
    setTimeout(async () => {
      try {
        await runNightlyAlert();
      } catch (err) {
        console.error('[weightSync] Nightly run error:', err);
      }
      scheduleNext();
    }, delay);
  }

  scheduleNext();
}

// ─── Write a single variant's true weight metafield ──────────────────────────

interface MetafieldsSetResponse {
  data: {
    metafieldsSet: {
      metafields: Array<{ key: string; value: string }>;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  };
}

export async function setVariantTrueWeight(
  variantId: string,
  grams: number
): Promise<void> {
  const gid = variantId.startsWith('gid://')
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;

  const mutation = `
    mutation setWeight($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { key value }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    metafields: [{
      ownerId: gid,
      namespace: 'custom',
      key: 'actual_weight_grams',
      value: String(grams),
      type: 'number_decimal',
    }],
  };

  const resp = await shopifyGraphql<MetafieldsSetResponse>(mutation, variables);
  const errors = resp.data?.metafieldsSet?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`Shopify metafield error: ${errors.map(e => e.message).join(', ')}`);
  }

  console.log(`[weightSync] Set variant ${variantId} true weight to ${grams}g`);
}
