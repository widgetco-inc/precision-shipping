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
  };
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

function shopifyWeightToGrams(weight: number, unit: string): number {
  switch (unit.toUpperCase()) {
    case 'GRAMS': return weight;
    case 'KILOGRAMS': return weight * 1000;
    case 'OUNCES': return weight * 28.3495;
    case 'POUNDS': return weight * 453.592;
    default: return weight;
  }
}

export async function resolveTrueWeightGrams(
  variantId?: string,
  sku?: string,
  directValue?: number
): Promise<number> {
  // 1. Caller passed an explicit weight — trust it
  if (typeof directValue === 'number' && directValue > 0) return directValue;

  // 2. No variantId — nothing to look up
  if (!variantId) return 0;

  checkCacheExpiry();
  if (cache.has(variantId)) return cache.get(variantId)!;

  try {
    const gid = variantId.startsWith('gid://')
      ? variantId
      : `gid://shopify/ProductVariant/${variantId}`;

    const query = `
      query getVariantWeight($id: ID!) {
        productVariant(id: $id) {
          id
          sku
          weight
          weightUnit
          metafield(namespace: "custom", key: "actual_weight_grams") {
            value
          }
        }
      }
    `;

    const resp = await shopifyGraphql<VariantResponse>(query, { id: gid });
    const variant = resp.data?.productVariant;

    if (!variant) {
      console.warn(`[catalog] Variant not found: ${variantId}`);
      cache.set(variantId, 0);
      return 0;
    }

    // Prefer the true-weight metafield
    const metafieldValue = variant.metafield?.value
      ? parseFloat(variant.metafield.value)
      : null;

    if (metafieldValue !== null && !isNaN(metafieldValue) && metafieldValue > 0) {
      console.log(`[catalog] ${variantId} (${variant.sku}) → metafield: ${metafieldValue}g`);
      cache.set(variantId, metafieldValue);
      return metafieldValue;
    }

    // Fall back to Shopify's own catalog weight
    const shopifyGrams = shopifyWeightToGrams(variant.weight ?? 0, variant.weightUnit ?? 'GRAMS');
    console.warn(
      `[catalog] ${variantId} (${variant.sku}) — no metafield, using Shopify weight: ${shopifyGrams}g`
    );
    cache.set(variantId, shopifyGrams);
    return shopifyGrams;

  } catch (err) {
    console.error(`[catalog] Error fetching variant ${variantId}:`, err);
    return 0;
  }
}
