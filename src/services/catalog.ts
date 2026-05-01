import { shopifyGraphql } from '../shopify';
import { Pool } from 'pg';

interface MetafieldNode { value: string; }
interface VariantNode {
  id: string; sku: string; weight: number; weightUnit: string;
  metafield: MetafieldNode | null;
}
interface VariantResponse { data: { productVariant: VariantNode | null; } }
interface BatchVariantNode {
  __typename: string; id: string; sku: string;
  weight: number; weightUnit: string; metafield: MetafieldNode | null;
}
interface NodesResponse { data: { nodes: BatchVariantNode[]; } }

// ── Postgres pool (same DB as weightSync) ────────────────────────────────────
let _pool: Pool | null = null;
function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
    });
  }
  return _pool;
}

/**
 * Look up a single SKU weight from the uploaded_weights DB table.
 * Returns null if not found.
 */
async function lookupUploadedWeightBySku(sku: string): Promise<number | null> {
  if (!sku) return null;
  try {
    const result = await getPool().query(
      'SELECT grams FROM uploaded_weights WHERE UPPER(sku) = $1 LIMIT 1',
      [sku.toUpperCase()]
    );
    if (result.rows.length > 0) return parseFloat(result.rows[0].grams);
    return null;
  } catch (err) {
    console.warn('[catalog] DB weight lookup failed:', err);
    return null;
  }
}

// In-process cache: variantId -> grams. Cleared every 5 minutes.
const cache = new Map<string, number>();
let cacheResetAt = Date.now() + 5 * 60 * 1000;
function checkCacheExpiry() {
  if (Date.now() > cacheResetAt) {
    cache.clear();
    cacheResetAt = Date.now() + 5 * 60 * 1000;
  }
}

function toGid(variantId: string): string {
  return variantId.startsWith('gid://')
    ? variantId
    : `gid://shopify/ProductVariant/${variantId}`;
}

export function shopifyWeightToGrams(weight: number, unit: string): number {
  switch (unit.toUpperCase()) {
    case 'GRAMS': return weight;
    case 'KILOGRAMS': return weight * 1000;
    case 'OUNCES': return weight * 28.3495;
    case 'POUNDS': return weight * 453.592;
    default: return weight;
  }
}

/**
 * Batch-fetch true weights for an array of variant IDs.
 * skuMap is an optional Map<variantId, sku> for DB-first lookup.
 *
 * Priority:
 *   1. uploaded_weights DB (by SKU) — our CSV true weights, no Shopify API needed
 *   2. Shopify custom.actual_weight_grams metafield
 *   3. Shopify catalog weight (last resort)
 *
 * Returns a Map<variantId, grams>.
 */
export async function resolveWeightsBatch(
  variantIds: string[],
  skuMap?: Map<string, string>
): Promise<Map<string, number>> {
  checkCacheExpiry();
  const result = new Map<string, number>();
  const toFetch: string[] = [];

  // Serve what we have from cache
  for (const vid of variantIds) {
    if (cache.has(vid)) {
      result.set(vid, cache.get(vid)!);
    } else {
      toFetch.push(vid);
    }
  }
  if (toFetch.length === 0) return result;

  // ── Step 1: DB uploaded_weights by SKU (primary — no Shopify API needed) ───
  const stillNeeded: string[] = [];
  for (const vid of toFetch) {
    const sku = skuMap?.get(vid);
    if (sku) {
      const dbGrams = await lookupUploadedWeightBySku(sku);
      if (dbGrams !== null && dbGrams > 0) {
        console.log(`[catalog] ${vid} (${sku}) → DB uploaded weight: ${dbGrams}g`);
        cache.set(vid, dbGrams);
        result.set(vid, dbGrams);
        continue;
      }
    }
    stillNeeded.push(vid);
  }

  if (stillNeeded.length === 0) return result;

  // ── Step 2: Shopify GraphQL metafield for any remaining variants ─────────────
  const gids = stillNeeded.map(toGid);
  const query = `
    query getVariantWeights($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          __typename id sku weight weightUnit
          metafield(namespace: "custom", key: "actual_weight_grams") { value }
        }
      }
    }
  `;

  try {
    const resp = await shopifyGraphql<NodesResponse>(query, { ids: gids });
    const nodes = resp.data?.nodes ?? [];

    for (let i = 0; i < stillNeeded.length; i++) {
      const vid = stillNeeded[i];
      const node = nodes[i];

      if (!node || node.__typename !== 'ProductVariant') {
        console.warn(`[catalog] Variant not found in batch: ${vid}`);
        cache.set(vid, 0);
        result.set(vid, 0);
        continue;
      }

      // Prefer true-weight metafield
      const metafieldValue = node.metafield?.value
        ? parseFloat(node.metafield.value) : null;
      if (metafieldValue !== null && !isNaN(metafieldValue) && metafieldValue > 0) {
        console.log(`[catalog] ${vid} (${node.sku}) → metafield: ${metafieldValue}g`);
        cache.set(vid, metafieldValue);
        result.set(vid, metafieldValue);
        continue;
      }

      // Fall back to Shopify catalog weight
      const shopifyGrams = shopifyWeightToGrams(node.weight ?? 0, node.weightUnit ?? 'GRAMS');
      console.warn(
        `[catalog] ${vid} (${node.sku}) — no metafield, using Shopify catalog weight: ${shopifyGrams}g`
      );
      cache.set(vid, shopifyGrams);
      result.set(vid, shopifyGrams);
    }
  } catch (err) {
    console.error('[catalog] Batch weight fetch error:', err);
    for (const vid of stillNeeded) {
      if (!result.has(vid)) {
        result.set(vid, 0);
      }
    }
  }

  return result;
}

/**
 * Single-variant lookup — kept for backwards compatibility and the preview route.
 * Prefer resolveWeightsBatch() for carrier callback (N items).
 */
export async function resolveTrueWeightGrams(
  variantId?: string,
  sku?: string,
  directValue?: number
): Promise<number> {
  if (typeof directValue === 'number' && directValue > 0) return directValue;
  if (!variantId) return 0;
  const skuMap = sku ? new Map([[variantId, sku]]) : undefined;
  const batchResult = await resolveWeightsBatch([variantId], skuMap);
  return batchResult.get(variantId) ?? 0;
}
