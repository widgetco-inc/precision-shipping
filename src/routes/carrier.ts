import { Router } from 'express';
import { buildShipment } from '../services/ratingEngine';
import { EasyPostAdapter } from '../carriers/easypost';
import { requireApprovedAdmin } from './auth';

const router = Router();

router.post('/carrier-service/rates', async (req, res) => {
  try {
    const rateReq = req.body?.rate;
    const items = Array.isArray(rateReq?.items) ? rateReq.items : [];
    const lines = items.map((item: any) => {
      const rawVariantId = item.variant_id;
      const variantId = rawVariantId != null ? String(rawVariantId) : '';
      return {
        variantId,
        sku: item.sku ? String(item.sku) : undefined,
        title: item.product_title ? String(item.product_title) : undefined,
        quantity: Number(item.quantity ?? 1),
        grams: Number(item.grams ?? 0),
      };
    });

    const destination = {
      countryCode: String(rateReq?.destination?.country ?? ''),
      postalCode: String(rateReq?.destination?.postal_code ?? ''),
      provinceCode: rateReq?.destination?.province ? String(rateReq.destination.province) : undefined,
      city: rateReq?.destination?.city ? String(rateReq.destination.city) : undefined,
      address1: rateReq?.destination?.address1 ? String(rateReq.destination.address1) : undefined,
    };

    const shipment = await buildShipment(lines, destination);
    const adapters = [new EasyPostAdapter()];
    const results = await Promise.all(adapters.map((a) => a.getRates(shipment)));
    const quotes = results.flat().sort((a, b) => a.amountUsd - b.amountUsd);

    res.json({
      rates: quotes.map((q) => ({
        service_name: q.serviceName,
        service_code: `${q.carrier}:${q.serviceCode}`,
        total_price: Math.round(q.amountUsd * 100).toString(),
        currency: q.currency,
        description: `True weight: ${shipment.totalShipmentWeightLb.toFixed(3)} lb`,
      })),
    });
  } catch (err) {
    console.error('[carrier] Rate callback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/carrier-service/register
 * One-time admin call to register this app as a Shopify carrier service.
 * Uses SHOPIFY_ADMIN_ACCESS_TOKEN, SHOPIFY_SHOP, APP_BASE_URL env vars.
 */
router.post('/api/carrier-service/register', requireApprovedAdmin, async (req, res) => {
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const shop  = process.env.SHOPIFY_SHOP;
  const appBaseUrl = (process.env.APP_BASE_URL ?? 'https://ship.widgetco.com').replace(/\/$/, '');

  if (!token || !shop) {
    res.status(500).json({ error: 'SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_SHOP not set' });
    return;
  }

  const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2024-01';
  const url = `https://${shop}/admin/api/${apiVersion}/carrier_services.json`;

  try {
    // Check if already registered
    const listRes = await fetch(url, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    const listData: any = await listRes.json();

    if (!listRes.ok) {
      res.status(listRes.status).json({ error: 'Shopify list failed', details: listData });
      return;
    }

    const existing = (listData.carrier_services ?? []).find(
      (cs: any) => cs.callback_url?.includes('carrier-service/rates')
    );
    if (existing) {
      res.json({ ok: true, status: 'already_registered', carrier_service: existing });
      return;
    }

    // Register
    const createRes = await fetch(url, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carrier_service: {
          name: 'Precision Shipping',
          callback_url: `${appBaseUrl}/carrier-service/rates`,
          service_discovery: true,
          format: 'json',
          active: true,
        },
      }),
    });
    const createData: any = await createRes.json();

    if (!createRes.ok) {
      res.status(createRes.status).json({ error: 'Shopify registration failed', details: createData });
      return;
    }

    console.log('[carrier] Registered carrier service:', createData.carrier_service?.id);
    res.json({ ok: true, status: 'registered', carrier_service: createData.carrier_service });
  } catch (err: any) {
    console.error('[carrier] Registration error:', err);
    res.status(500).json({ error: err?.message ?? 'Registration failed' });
  }
});

export default router;
