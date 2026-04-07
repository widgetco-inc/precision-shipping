import { shopifyGraphql } from '../shopify';

interface MetafieldNode {
  value: string;
}

interface VariantNode {
  id: string;
  sku: string;
  weight: number;
  weightUnit: string;
  metafield: MetafieldNode | null;
}

interface VariantResponse {
  data: {
    productVariant: VariantNode | null;
  }
}

interface BatchVariantNode {
  __typename: string;
  id: string;
  sku: string;
  weight: number;
  weightUnit: string;
  metafield: MetafieldNode | null;
}

interface NodesResponse {
  data: {
    nodes: BatchVariantNode[];
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
 * Batch-fetch true weights for an array of variant IDs in a single GraphQL call.
 * Returns a Map<variantId, grams>.
 * Skips variants already in cache. Missing or error variants default to 0.
 */
export async function resolveWeightsBatch(
  variantIds: string[]
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

  const gids = toFetch.map(toGid);

  const query = `
    query getVariantWeights($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          __typename
          id
          sku
          weight
          weightUnit
          metafield(namespace: "custom", key: "actual_weight_grams") {
            value
          }
        }
      }
    }
  `;

  try {
    const resp = await shopifyGraphql<NodesResponse>(query, { ids: gids });
    const nodes = resp.data?.nodes ?? [];

    for (let i = 0; i < toFetch.length; i++) {
      const vid = toFetch[i];
      const node = nodes[i];

      if (!node || node.__typename !== 'ProductVariant') {
        console.warn(`[catalog] Variant not found in batch: ${vid}`);
        cache.set(vid, 0);
        result.set(vid, 0);
        continue;
      }

      // Prefer true-weight metafield
      const metafieldValue = node.metafield?.value
        ? parseFloat(node.metafield.value)
        : null;

      if (metafieldValue !== null && !isNaN(metafieldValue) && metafieldValue > 0) {
        console.log(`[catalog] ${vid} (${node.sku}) → metafield: ${metafieldValue}g`);
        cache.set(vid, metafieldValue);
        result.set(vid, metafieldValue);
        continue;
      }

      // Fall back to Shopify catalog weight
      const shopifyGrams = shopifyWeightToGrams(node.weight ?? 0, node.weightUnit ?? 'GRAMS');
      console.warn(
        `[catalog] ${vid} (${node.sku}) — no metafield, using Shopify weight: ${shopifyGrams}g`
      );
      cache.set(vid, shopifyGrams);
      result.set(vid, shopifyGrams);
    }
  } catch (err) {
    console.error('[catalog] Batch weight fetch error:', err);
    // On error, default all unfetched to 0
    for (const vid of toFetch) {
      if (!result.has(vid)) {
        result.set(vid, 0);
      }
    }
  }

  return result;
}

/**
 * Single-variant lookup - kept for backwards compatibility and the preview route.
 * Prefer resolveWeightsBatch() for carrier callback (N items).
 */
export async function resolveTrueWeightGrams(
  variantId?: string,
  sku?: string,
  directValue?: number
): Promise<number> {
  // 1. Caller passed an explicit weight - trust it
  if (typeof directValue === 'number' && directValue > 0) return directValue;

  // 2. No variantId - nothing to look up
  if (!variantId) return 0;

  const batchResult = await resolveWeightsBatch([variantId]);
  return batchResult.get(variantId) ?? 0;
}
