import { Router } from 'express';
import { requireApprovedAdmin } from './auth';
import { env } from '../lib/env';

const router = Router();

/**
 * GET /api/orders
 * Returns open, unfulfilled Shopify orders (excluding cancelled).
 * Fields returned: id, name, created_at, updated_at, total_price,
 *   fulfillment_status, financial_status, shipping_address, line_items
 */
router.get('/api/orders', requireApprovedAdmin, async (_req, res) => {
  const { shopifyShop, shopifyAdminAccessToken, shopifyApiVersion } = env;

  if (!shopifyShop || !shopifyAdminAccessToken) {
    return res.json({ error: 'Shopify credentials not configured (SHOPIFY_SHOP / SHOPIFY_ADMIN_ACCESS_TOKEN)' });
  }

  try {
    const url = `https://${shopifyShop}/admin/api/${shopifyApiVersion}/orders.json` +
      '?status=open&fulfillment_status=unfulfilled&fields=id,name,created_at,updated_at,total_price,fulfillment_status,financial_status,shipping_address,line_items&limit=50';

    const resp = await fetch(url, {
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
    return res.json({ orders: data.orders });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.json({ error: 'Failed to fetch orders: ' + msg });
  }
});

export default router;
