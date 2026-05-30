import { Router } from 'express';
import { z } from 'zod';
import { buildShipment } from '../services/ratingEngine';
import { EasyPostAdapter } from '../carriers/easypost';
import { requireApprovedAdmin } from './auth';
import {
    US_48_RULES,
    CANADA_RULES,
    AK_HI_TERRITORY_RULES,
    REST_OF_WORLD_RULES,
    ZoneRules,
} from '../config/shippingRules';
import { RateQuote } from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// uspsGroundTransitDays — same helper as carrier.ts
// ---------------------------------------------------------------------------
function uspsGroundTransitDays(allQuotes: RateQuote[]): number {
    const uspsGround = allQuotes.find((q) => {
          const name = q.serviceName.toLowerCase();
          const carrier = q.carrier.toLowerCase();
          return (
                  name.includes('ground advantage') ||
                  (carrier.includes('usps') && name.includes('ground'))
                );
    });
    if (uspsGround && uspsGround.estDeliveryDays != null && uspsGround.estDeliveryDays > 0) {
          return uspsGround.estDeliveryDays;
    }
    return 5;
}

// ---------------------------------------------------------------------------
// applyZoneRulesForPreview — returns filtered rates with zone rules applied.
// When subtotal is provided the estimator shows exactly what checkout will show.
// When subtotal is null it falls back to raw EasyPost rates (original behaviour).
// ---------------------------------------------------------------------------
function applyZoneRulesForPreview(
    allQuotes: RateQuote[],
    subtotal: number,
    rules: ZoneRules,
  ): RateQuote[] {
    const suppressSet = new Set((rules.suppressCarriers ?? []).map((s) => s.toLowerCase()));
    const filteredQuotes = allQuotes.filter((q) => {
          const nameL = q.serviceName.toLowerCase();
          const carrierL = q.carrier.toLowerCase();
          return ![...suppressSet].some((s) => nameL.includes(s) || carrierL.includes(s));
    });

  const results: RateQuote[] = [];

  // Flat tiers — first match exits
  for (const tier of rules.flatTiers ?? []) {
        const minOk = tier.minSubtotal === undefined || subtotal >= tier.minSubtotal;
        const maxOk = tier.maxSubtotal === undefined || subtotal <= tier.maxSubtotal;
        if (minOk && maxOk) {
                const transitDays = uspsGroundTransitDays(allQuotes);
                results.push({
                          carrier: 'widgetco',
                          serviceCode: 'WIDGETCO:STANDARD',
                          serviceName: tier.label,
                          amountUsd: tier.price,
                          currency: 'USD',
                          estDeliveryDays: transitDays,
                });
                // Flat tier matched — also include express calcTiers that have no subtotal cap
          for (const ctier of rules.calcTiers ?? []) {
                    const cMinOk = ctier.minSubtotal === undefined || subtotal >= ctier.minSubtotal;
                    const cMaxOk = ctier.maxSubtotal === undefined || subtotal <= ctier.maxSubtotal;
                    if (!cMinOk || !cMaxOk) continue;
                    const allowed = filteredQuotes.filter((q) =>
                                ctier.carriers.some(
                                              (c) =>
                                                              q.serviceName.toLowerCase().includes(c.toLowerCase()) ||
                                                              q.carrier.toLowerCase().includes(c.toLowerCase())
                                            )
                                                                  );
                    for (const q of allowed) {
                                const price = ctier.overridePrice !== undefined ? ctier.overridePrice : q.amountUsd;
                                results.push({ ...q, amountUsd: price });
                    }
          }
                return results.sort((a, b) => a.amountUsd - b.amountUsd);
        }
  }

  // Calc tiers only
  for (const tier of rules.calcTiers ?? []) {
        const minOk = tier.minSubtotal === undefined || subtotal >= tier.minSubtotal;
        const maxOk = tier.maxSubtotal === undefined || subtotal <= tier.maxSubtotal;
        if (!minOk || !maxOk) continue;
        const allowed = filteredQuotes.filter((q) =>
                tier.carriers.some(
                          (c) =>
                                      q.serviceName.toLowerCase().includes(c.toLowerCase()) ||
                                      q.carrier.toLowerCase().includes(c.toLowerCase())
                        )
                                                  );
        if (tier.cheapestOnly) {
                const cheapest = allowed.reduce((a, b) => (a.amountUsd <= b.amountUsd ? a : b), allowed[0]);
                if (cheapest) {
                          const price = tier.overridePrice !== undefined ? tier.overridePrice : cheapest.amountUsd;
                          results.push({ ...cheapest, amountUsd: price });
                }
        } else {
                for (const q of allowed) {
                          const price = tier.overridePrice !== undefined ? tier.overridePrice : q.amountUsd;
                          results.push({ ...q, amountUsd: price });
                }
        }
  }

  // Pass-through zones
  if (rules.passThrough) {
        const suppressUsps =
                rules.suppressUspsOverSubtotal !== undefined && subtotal >= rules.suppressUspsOverSubtotal;
        for (const q of allQuotes) {
                const nameL = q.serviceName.toLowerCase();
                const carrierL = q.carrier.toLowerCase();
                const isUsps = nameL.includes('usps') || carrierL.includes('usps') ||
                          nameL.includes('ground advantage') || nameL.includes('first class') ||
                          nameL.includes('priority mail');
                if ([...suppressSet].some((s) => nameL.includes(s) || carrierL.includes(s))) continue;
                if (isUsps && suppressUsps) continue;
                results.push(q);
        }
  }

  return results.sort((a, b) => a.amountUsd - b.amountUsd);
}

const previewSchema = z.object({
    destination: z.object({
          countryCode: z.string().min(2),
          provinceCode: z.string().optional(),
          postalCode: z.string().optional(),
          city: z.string().optional(),
          address1: z.string().optional(),
    }),
    fromZip: z.string().optional(),
    isResidential: z.boolean().optional(),
    subtotal: z.number().nonnegative().optional(),
    lines: z.array(z.object({
          variantId: z.string().optional(),
          sku: z.string().optional(),
          title: z.string().optional(),
          quantity: z.number().int().positive(),
          trueWeightGrams: z.number().positive().optional(),
          trueWeightLbs: z.number().positive().optional(),
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
    const results = await Promise.all(adapters.map((a) => a.getRates(shipment, parsed.data.fromZip, parsed.data.isResidential)));
    const allQuotes = results.flat().sort((a, b) => a.amountUsd - b.amountUsd);

              // If subtotal provided, apply zone rules exactly as checkout does
              const subtotal = parsed.data.subtotal;
    let rates: RateQuote[];
    if (subtotal !== undefined) {
          let rules: ZoneRules;
          if (shipment.isDomestic && !shipment.isHiAkTerritory) {
                  rules = US_48_RULES;
          } else if (shipment.isCanada) {
                  rules = CANADA_RULES;
          } else if (shipment.isHiAkTerritory) {
                  rules = AK_HI_TERRITORY_RULES;
          } else {
                  rules = REST_OF_WORLD_RULES;
          }
          rates = applyZoneRulesForPreview(allQuotes, subtotal, rules);
    } else {
          // No subtotal — raw rates (original estimator behaviour)
      rates = allQuotes;
    }

              res.json({ shipment, rates });
});

export default router;
