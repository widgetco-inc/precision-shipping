import { Router } from 'express';
import { buildShipment } from '../services/ratingEngine';
import { FedexAdapter } from '../carriers/fedex';
import { UpsAdapter } from '../carriers/ups';
import { UspsAdapter } from '../carriers/usps';

const router = Router();

router.post('/carrier-service/rates', async (req, res) => {
  const rateReq = req.body?.rate;
  const items = Array.isArray(rateReq?.items) ? rateReq.items : [];
  const lines = items.map((item: any) => ({
    variantId: String(item.variant_id ?? ''),
    sku: item.sku ? String(item.sku) : undefined,
    title: item.product_title ? String(item.product_title) : undefined,
    quantity: Number(item.quantity ?? 1),
    trueWeightGrams: undefined
  }));

  const destination = {
    countryCode: String(rateReq?.destination?.country ?? 'US'),
    provinceCode: rateReq?.destination?.province ? String(rateReq.destination.province) : undefined,
    postalCode: rateReq?.destination?.postal_code ? String(rateReq.destination.postal_code) : undefined,
    city: rateReq?.destination?.city ? String(rateReq.destination.city) : undefined
  };

  const shipment = buildShipment(lines, destination);
  const adapters = [new FedexAdapter(), new UpsAdapter(), new UspsAdapter()];
  const results = await Promise.all(adapters.map((adapter) => adapter.getRates(shipment)));
  const quotes = results.flat().sort((a, b) => a.amountUsd - b.amountUsd);

  res.json({
    rates: quotes.map((quote) => ({
      service_name: quote.serviceName,
      service_code: `${quote.carrier}:${quote.serviceCode}`,
      total_price: Math.round(quote.amountUsd * 100).toString(),
      currency: quote.currency,
      description: `Calculated at true shipment weight ${shipment.totalShipmentWeightLb.toFixed(2)} lb`
    }))
  });
});

export default router;
