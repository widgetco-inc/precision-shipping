import { Router } from 'express';
import { buildShipment } from '../services/ratingEngine';
import { FedexAdapter } from '../carriers/fedex';
import { UpsAdapter } from '../carriers/ups';
import { UspsAdapter } from '../carriers/usps';

const router = Router();

router.post('/carrier-service/rates', async (req, res) => {
  try {
    const rateReq = req.body?.rate;
    const items = Array.isArray(rateReq?.items) ? rateReq.items : [];

    const lines = items.map((item: any) => ({
      variantId: String(item.variant_id ?? ''),
      sku: item.sku ? String(item.sku) : undefined,
      title: item.product_title ? String(item.product_title) : undefined,
      quantity: Number(item.quantity ?? 1),
      trueWeightGrams: undefined,
    }));

    const destination = {
      countryCode:  String(rateReq?.destination?.country ?? 'US'),
      provinceCode: rateReq?.destination?.province
        ? String(rateReq.destination.province) : undefined,
      postalCode:   rateReq?.destination?.postal_code
        ? String(rateReq.destination.postal_code) : undefined,
      city:         rateReq?.destination?.city
        ? String(rateReq.destination.city) : undefined,
      address1:     rateReq?.destination?.address1
        ? String(rateReq.destination.address1) : undefined,
    };

    const shipment = await buildShipment(lines, destination);

    const adapters = [new FedexAdapter(), new UpsAdapter(), new UspsAdapter()];
    const results = await Promise.all(adapters.map((a) => a.getRates(shipment)));
    const quotes = results.flat().sort((a, b) => a.amountUsd - b.amountUsd);

    res.json({
      rates: quotes.map((q) => ({
        service_name:  q.serviceName,
        service_code:  `${q.carrier}:${q.serviceCode}`,
        total_price:   Math.round(q.amountUsd * 100).toString(),
        currency:      q.currency,
        description:   `True weight: ${shipment.totalShipmentWeightLb.toFixed(3)} lb`,
      })),
    });
  } catch (err) {
    console.error('[carrier-service/rates] Error:', err);
    res.json({ rates: [] });
  }
});

export default router;
