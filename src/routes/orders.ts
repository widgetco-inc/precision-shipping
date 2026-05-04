import { Router } from 'express';
import { requireApprovedAdmin } from './auth';
import { env } from '../lib/env';

const router = Router();

/**
 * GET /api/orders
 * Returns ALL open, unfulfilled Shopify orders (excluding cancelled).
 * Uses cursor-based pagination to fetch beyond the 250-order limit.
 */
router.get('/api/orders', requireApprovedAdmin, async (_req, res) => {
  const { shopifyShop, shopifyAdminAccessToken, shopifyApiVersion } = env;

  if (!shopifyShop || !shopifyAdminAccessToken) {
    return res.json({ error: 'Shopify credentials not configured (SHOPIFY_SHOP / SHOPIFY_ADMIN_ACCESS_TOKEN)' });
  }

  const fields = 'id,name,created_at,updated_at,total_price,fulfillment_status,financial_status,shipping_address,line_items';
  const baseUrl = `https://${shopifyShop}/admin/api/${shopifyApiVersion}/orders.json`;

  try {
    const allOrders: unknown[] = [];
    let nextUrl: string | null =
      `${baseUrl}?status=open&fulfillment_status=unfulfilled&fields=${fields}&limit=250`;

    while (nextUrl) {
      const resp = await fetch(nextUrl, {
        headers: {
          'X-Shopify-Access-Token': shopifyAdminAccessToken,
          'Content-Type': 'application/json',
        },
      });

      if (!resp.ok) {
        const errText = await resp.text();
        return res.json({ error: `Shopify API error ${resp.status}: ${errText.substring(0, 200)}` });
      }

      const data = await resp.json() as { orders: unknown[] };
      allOrders.push(...data.orders);

      // Parse the Link header for next page cursor
      const linkHeader = resp.headers.get('link') || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;s*rel="next"/);
      nextUrl = nextMatch ? nextMatch[1] : null;
    }

    return res.json({ orders: allOrders });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ error: 'Failed to fetch orders: ' + msg });
  }
});

export default router;
