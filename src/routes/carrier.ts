import { Router } from 'express';
import { buildShipment } from '../services/ratingEngine';
import { EasyPostAdapter } from '../carriers/easypost';

const router = Router();

router.post('/carrier-service/rates', async (req, res) => {
  try {
    const rateReq = req.body?.rate;
    const items = Array.isArray(rateReq?.items) ? rateReq.items : [];

    const lines = items.map((item: any) => {
      // variant_id arrives as a plain integer from Shopify's carrier callback.
      // Convert to string so catalog.ts can build the GID correctly.
      const rawVariantId = item.variant_id;
      const variantId = rawVariantId != null ? String(rawVariantId) : '';

      return {
        variantId,
        sku: item.sku ? String(item.sku) : undefined,
        title: item.product_title ? String(item.product_title) : undefined,
        quantity: Number(item.quantity ?? 1),
        // item.grams is Shopify's rounded integer weight.
        // We prefer the true weight from metafields (resolved in buildShipment).
        grams: Number(item.grams ?? 0),
      };
    });

    const destination = {
      countryCode: String(rateReq?.destination?.country ?? ''),
      postalCode: String(rateReq?.destination?.postal_code ?? ''),
      provinceCode: rateReq?.destination?.province
        ? String(rateReq.destination.province)
        : undefined,
      city: rateReq?.destination?.city
        ? String(rateReq.destination.city)
        : undefined,
      address1: rateReq?.destination?.address1
        ? String(rateReq.destination.address1) : undefined,
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

export default router;
