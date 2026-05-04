import { Router } from 'express';
import { requireApprovedAdmin } from './auth';
import { env } from '../lib/env';

const router = Router();

/**
 * GET /api/orders
 * Returns ALL open orders that still have items to ship:
 * - fulfillment_status=unfulfilled (nothing shipped yet)
 * - fulfillment_status=partial (some items shipped, some not)
 * Uses cursor-based pagination (250/page) to fetch beyond the 250-order limit.
 */
router.get('/api/orders', requireApprovedAdmin, async (_req, res) => {
  const { shopifyShop, shopifyAdminAccessToken, shopifyApiVersion } = env;

  if (!shopifyShop || !shopifyAdminAccessToken) {
    return res.json({ error: 'Shopify credentials not configured (SHOPIFY_SHOP / SHOPIFY_ADMIN_ACCESS_TOKEN)' });
  }

  const fields = 'id,name,created_at,updated_at,total_price,fulfillment_status,financial_status,shipping_address,line_items';
  const baseUrl = `https://${shopifyShop}/admin/api/${shopifyApiVersion}/orders.json`;

  async function fetchAllPages(startUrl: string): Promise<unknown[]> {
    const results: unknown[] = [];
    let nextUrl: string | null = startUrl;
    let page = 0;
    while (nextUrl) {
      page++;
      console.log(`[orders] Fetching page ${page}: ${nextUrl}`);
      const resp = await fetch(nextUrl, {
        headers: {
          'X-Shopify-Access-Token': shopifyAdminAccessToken!,
          'Content-Type': 'application/json',
        },
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Shopify API error ${resp.status}: ${errText.substring(0, 200)}`);
      }
      const data = await resp.json() as { orders: unknown[] };
      results.push(...data.orders);
      console.log(`[orders] Page ${page}: got ${data.orders.length} orders, total so far: ${results.length}`);
      // Parse Link header for cursor-based next page
      const linkHeader = resp.headers.get('link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
      nextUrl = nextMatch ? nextMatch[1] : null;
      console.log(`[orders] Next URL: ${nextUrl ? 'yes' : 'none'}`);
    }
    return results;
  }

  try {
    // Fetch unfulfilled orders (fulfillment_status=null in Shopify, queried as 'unfulfilled')
    const unfulfilledUrl = `${baseUrl}?status=open&fulfillment_status=unfulfilled&fields=${fields}&limit=250`;
    // Fetch partial orders (some line items shipped, some not)
    const partialUrl = `${baseUrl}?status=open&fulfillment_status=partial&fields=${fields}&limit=250`;

    console.log('[orders] Starting fetch for unfulfilled orders...');
    const unfulfilled = await fetchAllPages(unfulfilledUrl);
    console.log('[orders] Starting fetch for partial orders...');
    const partial = await fetchAllPages(partialUrl);

    const allOrders = [...unfulfilled, ...partial];
    console.log(`[orders] Total: ${unfulfilled.length} unfulfilled + ${partial.length} partial = ${allOrders.length}`);

    return res.json({ orders: allOrders });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[orders] Error:', msg);
    return res.json({ error: 'Failed to fetch orders: ' + msg });
  }
});

export default router;
