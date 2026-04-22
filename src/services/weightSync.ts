import fs from 'fs';
import path from 'path';
import { shopifyGraphql } from '../shopify';
import { shopifyWeightToGrams } from './catalog';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VariantWeightRecord {
    variantId: string; // bare numeric string, e.g. "1234567890"
  sku: string;
    productTitle: string;
    variantTitle: string;
    shopifyCatalogGrams: number; // Shopify's own rounded catalog weight
  metafieldGrams: number | null; // metafield true weight (null = not set)
  uploadedGrams: number | null;  // what you uploaded via CSV
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

export interface NightlyAlertResult {
    ranAt: string;
    warnings: SyncWarning[];
}

export interface CsvImportResult {
    attempted: number;
    succeeded: number;
    skipped: number;
    errors: { sku: string; reason: string }[];
}

// ── Persistence ───────────────────────────────────────────────────────────────
const DATA_DIR = path.resolve(process.cwd(), 'data');
const SYNC_STATE_FILE = path.join(DATA_DIR, 'weightSync.json');
const UPLOADED_WEIGHTS_FILE = path.join(DATA_DIR, 'uploadedWeights.json');

function loadPersistedSyncResult(): SyncResult | null {
    try {
          if (fs.existsSync(SYNC_STATE_FILE)) {
                  const raw = fs.readFileSync(SYNC_STATE_FILE, 'utf8');
                  return JSON.parse(raw) as SyncResult;
          }
    } catch (e) {
          console.warn('[weightSync] Could not load persisted state:', e);
    }
    return null;
}

function persistSyncResult(result: SyncResult): void {
    try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(SYNC_STATE_FILE, JSON.stringify(result), 'utf8');
    } catch (e) {
          console.warn('[weightSync] Could not persist sync state:', e);
    }
}

export function loadUploadedWeights(): Record<string, number> {
    try {
          if (fs.existsSync(UPLOADED_WEIGHTS_FILE)) {
                  const raw = fs.readFileSync(UPLOADED_WEIGHTS_FILE, 'utf8');
                  return JSON.parse(raw) as Record<string, number>;
          }
    } catch (e) {
          console.warn('[weightSync] Could not load uploaded weights:', e);
    }
    return {};
}

function persistUploadedWeights(weights: Record<string, number>): void {
    try {
          if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
          fs.writeFileSync(UPLOADED_WEIGHTS_FILE, JSON.stringify(weights), 'utf8');
    } catch (e) {
          console.warn('[weightSync] Could not persist uploaded weights:', e);
    }
}

// ── In-memory state ───────────────────────────────────────────────────────────
let lastSyncResult: SyncResult | null = loadPersistedSyncResult();
let syncInProgress = false;
let lastNightlyAlert: NightlyAlertResult | null = null;

export function getLastSyncResult(): SyncResult | null { return lastSyncResult; }
export function isSyncInProgress(): boolean { return syncInProgress; }
export function getLastNightlyAlert(): NightlyAlertResult | null { return lastNightlyAlert; }

// ── Shopify GraphQL types ─────────────────────────────────────────────────────

interface MetafieldNode {
    value: string;
}

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

// ── Main scan ─────────────────────────────────────────────────────────────────

/**
 * Scans every product variant in Shopify.
 * Returns all records + a warnings list for missing/mismatched metafields.
 * Also merges in any uploaded CSV weights for display.
 */
export async function runWeightSync(): Promise<SyncResult> {
    if (syncInProgress) {
          throw new Error('Sync already in progress');
    }
    syncInProgress = true;

  const records: VariantWeightRecord[] = [];
    const uploadedWeights = loadUploadedWeights();

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

          const page = await shopifyGraphql<ProductVariantsResponse>(query, {});
              const edges = page.data?.productVariants?.edges ?? [];

          for (const { node } of edges) {
                    const variantId = node.id.replace('gid://shopify/ProductVariant/', '');
                    const shopifyCatalogGrams = shopifyWeightToGrams(node.weight, node.weightUnit);
                    const metafieldGrams = node.metafield?.value != null
                      ? (Number(node.metafield.value) as number)
                                : null;
                    const uploadedGrams = node.sku && uploadedWeights[node.sku] != null
                      ? uploadedWeights[node.sku]
                                : null;

                let status: 'ok' | 'missing' | 'mismatch';
                    if (metafieldGrams == null) {
                                status = 'missing';
                    } else if (Math.abs(metafieldGrams - shopifyCatalogGrams) / shopifyCatalogGrams > 0.2) {
                                status = 'mismatch';
                    } else {
                                status = 'ok';
                    }

                records.push({
                            variantId,
                            sku: node.sku,
                            productTitle: node.product.title,
                            variantTitle: node.displayName,
                            shopifyCatalogGrams,
                            metafieldGrams,
                            uploadedGrams,
                            status,
                });
          }

          hasNext = page.data?.productVariants?.pageInfo?.hasNextPage ?? false;
              cursor = page.data?.productVariants?.pageInfo?.endCursor ?? null;
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
                                : `True weight (${r.metafieldGrams}g) differs >20% from Shopify catalog (${r.shopifyCatalogGrams}g) — please review`,
          }));

      lastSyncResult = {
              scannedCount: records.length,
              okCount: records.filter(r => r.status === 'ok').length,
              warnings,
              records,
              lastRunAt: new Date().toISOString(),
      };
        persistSyncResult(lastSyncResult);

      console.log(`[weightSync] Scanned ${records.length} variants: ${lastSyncResult.okCount} ok, ${warnings.length} warnings`);
        return lastSyncResult;
  } finally {
        syncInProgress = false;
  }
}

// ── CSV bulk import (LOCAL ONLY — no Shopify writes) ─────────────────────────

/**
 * Parses a CSV string and saves SKU→grams mapping to disk.
 * Does NOT write to Shopify. Read-only Shopify access only.
 *
 * Supported formats:
 * 1. Simple:    sku,grams  (header row optional; also accepts weight_grams as column name)
 * 2. Matrixify: ID,"Variant SKU","Metafield: custom.actual_weight_grams [single_line_text_field]"
 *    (header row required; column order determined by header names, not position)
 */
export async function bulkImportFromCsv(csvText: string): Promise<CsvImportResult> {
    const result: CsvImportResult = { attempted: 0, succeeded: 0, skipped: 0, errors: [] };

  // Parse rows
  const rows = csvText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

  if (rows.length === 0) return result;

  // Helper: split a CSV row respecting quoted fields
  function splitCsvRow(row: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuote = false;
        for (let i = 0; i < row.length; i++) {
                const ch = row[i];
                if (ch === '"') {
                          inQuote = !inQuote;
                } else if (ch === ',' && !inQuote) {
                          result.push(current.trim());
                          current = '';
                } else {
                          current += ch;
                }
        }
        result.push(current.trim());
        return result;
  }

  // Detect format by checking the header row
  const headerCells = splitCsvRow(rows[0]).map(h => h.toLowerCase().replace(/['"]/g, '').trim());
    const matrixifyWeightCol = headerCells.findIndex(h => h.includes('actual_weight_grams'));
    const matrixifySkuCol = headerCells.findIndex(h => h.includes('variant sku') || h === 'sku');
    const isMatrixify = matrixifyWeightCol !== -1 && matrixifySkuCol !== -1;

  // Simple format column detection
  const simpleSkuCol = headerCells.findIndex(h => h === 'sku' || h === 'variant sku');
    const simpleGramsCol = headerCells.findIndex(h => h === 'grams' || h === 'weight_grams' || h === 'weight');
    const hasSimpleHeader = simpleSkuCol !== -1 && simpleGramsCol !== -1;

  const dataRows = (isMatrixify || hasSimpleHeader) ? rows.slice(1) : rows;

  // Load existing uploaded weights and merge
  const uploadedWeights = loadUploadedWeights();

  for (const row of dataRows) {
        if (!row.trim()) continue;
        result.attempted++;

      const cells = splitCsvRow(row);

      let sku = '';
        let gramsRaw = '';

      if (isMatrixify) {
              sku = cells[matrixifySkuCol]?.replace(/^"|"$/g, '').trim() ?? '';
              gramsRaw = cells[matrixifyWeightCol]?.replace(/^"|"$/g, '').trim() ?? '';
      } else if (hasSimpleHeader) {
              sku = cells[simpleSkuCol]?.replace(/^"|"$/g, '').trim() ?? '';
              gramsRaw = cells[simpleGramsCol]?.replace(/^"|"$/g, '').trim() ?? '';
      } else {
              // Positional: col 0 = sku, col 1 = grams
          sku = cells[0]?.replace(/^"|"$/g, '').trim() ?? '';
              gramsRaw = cells[1]?.replace(/^"|"$/g, '').trim() ?? '';
      }

      if (!sku) { result.skipped++; continue; }

      const grams = Number(gramsRaw);
        if (isNaN(grams) || grams < 0) {
                result.errors.push({ sku, reason: `Invalid grams value: "${gramsRaw}"` });
                result.skipped++;
                continue;
        }

      uploadedWeights[sku] = grams;
        result.succeeded++;
  }

  // Persist to disk — no Shopify calls at all
  persistUploadedWeights(uploadedWeights);

  // Merge uploaded weights into the current sync result for display
  if (lastSyncResult) {
        for (const record of lastSyncResult.records) {
                if (record.sku && uploadedWeights[record.sku] != null) {
                          record.uploadedGrams = uploadedWeights[record.sku];
                }
        }
        persistSyncResult(lastSyncResult);
  }

  console.log(`[weightSync] CSV import: ${result.succeeded}/${result.attempted} succeeded, ${result.skipped} skipped`);
    return result;
}

// ── Single variant true-weight update (kept for manual edits) ─────────────────

interface MetafieldsSetResponse {
    data: {
          metafieldsSet: {
                  userErrors: { field: string; message: string }[];
          };
    };
}

export async function setVariantTrueWeight(variantId: string, grams: number): Promise<void> {
    const gid = `gid://shopify/ProductVariant/${variantId}`;

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
}

// ── Nightly alert scheduler ───────────────────────────────────────────────────

interface FetchSkuToVariantIdMapResponse {
    data: {
          productVariants: {
                  pageInfo: { hasNextPage: boolean; endCursor: string };
                  edges: Array<{ node: { id: string; sku: string } }>;
          };
    };
}

async function fetchSkuToVariantIdMap(skus: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let cursor: string | null = null;
    let hasNext = true;

  while (hasNext) {
        const afterClause = cursor ? `, after: "${cursor}"` : '';
        const query = `
              query getVariantIds {
                      productVariants(first: 250${afterClause}) {
                                pageInfo { hasNextPage endCursor }
                                          edges { node { id sku } }
                                                  }
                                                        }
                                                            `;
        const page = await shopifyGraphql<FetchSkuToVariantIdMapResponse>(query, {});
        const edges = page.data?.productVariants?.edges ?? [];
        for (const { node } of edges) {
                if (skus.includes(node.sku)) {
                          map.set(node.sku, node.id.replace('gid://shopify/ProductVariant/', ''));
                }
        }
        hasNext = page.data?.productVariants?.pageInfo?.hasNextPage ?? false;
        cursor = page.data?.productVariants?.pageInfo?.endCursor ?? null;
  }
    return map;
}

export function scheduleNightlyAlert(): void {
    const now = new Date();
    const next2am = new Date(now);
    next2am.setHours(2, 0, 0, 0);
    if (next2am <= now) next2am.setDate(next2am.getDate() + 1);
    const msUntil2am = next2am.getTime() - now.getTime();

  setTimeout(() => {
        runNightlyAlert();
        setInterval(runNightlyAlert, 24 * 60 * 60 * 1000);
  }, msUntil2am);

  console.log(`[weightSync] Nightly alert scheduled for ${next2am.toISOString()}`);
}

async function runNightlyAlert(): Promise<void> {
    try {
          console.log('[weightSync] Running nightly alert scan...');
          const result = await runWeightSync();
          lastNightlyAlert = {
                  ranAt: new Date().toISOString(),
                  warnings: result.warnings,
          };
          if (result.warnings.length > 0) {
                  console.warn(`[weightSync] Nightly alert: ${result.warnings.length} warnings found`);
          }
    } catch (e) {
          console.error('[weightSync] Nightly alert failed:', e);
    }
}
