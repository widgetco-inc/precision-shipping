import { Router } from 'express';
import { z } from 'zod';
import { buildShipment } from '../services/ratingEngine';
import { EasyPostAdapter } from '../carriers/easypost';
import { requireApprovedAdmin } from './auth';

const router = Router();

const previewSchema = z.object({
  destination: z.object({
    countryCode:  z.string().min(2),
    provinceCode: z.string().optional(),
    postalCode:   z.string().optional(),
    city:         z.string().optional(),
    address1:     z.string().optional(),
  }),
  fromZip: z.string().optional(),
  lines: z.array(z.object({
    variantId:       z.string().optional(),
    sku:             z.string().optional(),
    title:           z.string().optional(),
    quantity:        z.number().int().positive(),
    trueWeightGrams: z.number().positive().optional(),
  })).min(1),
});

router.post('/api/preview', requireApprovedAdmin, async (req, res) => {
  const parsed = previewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const shipment = await buildShipment(parsed.data.lines, parsed.data.destination);
  const adapters = [new EasyPostAdapter()];
  const results = await Promise.all(adapters.map((a) => a.getRates(shipment, parsed.data.fromZip)));
  const rates = results.flat().sort((a, b) => a.amountUsd - b.amountUsd);

  res.json({ shipment, rates });
});

export default router;
