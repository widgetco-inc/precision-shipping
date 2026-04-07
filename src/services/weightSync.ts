import { shopifyGraphql } from '../shopify';
import { shopifyWeightToGrams } from './catalog';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VariantWeightRecord {
  variantId: string;       // bare numeric string, e.g. "1234567890"
  sku: string;
  productTitle: string;
  variantTitle: string;
  shopifyCatalogGrams: number;  // Shopify's own rounded catalog weight
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

// ─── In-memory last-run state (Railway keeps process alive) ──────────────────
let lastSyncResult: SyncResult | null = null;
let syncInProgress = false;

export function getLastSyncResult(): SyncResult | null { return lastSyncResult; }
export function isSyncInProgress(): boolean { return syncInProgress; }

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
