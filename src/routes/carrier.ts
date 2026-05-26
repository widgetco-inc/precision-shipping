import { Router } from 'express';
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
// applyZoneRules
// Filters and transforms raw EasyPost quotes according to a ZoneRules config.
// ---------------------------------------------------------------------------
function applyZoneRules(
    quotes: RateQuote[],
    subtotal: number,
    rules: ZoneRules
  ): Array<{ service_name: string; service_code: string; total_price: string; currency: string; description: string }> {
    const results: Array<{ service_name: string; service_code: string; total_price: string; currency: string; description: string }> = [];

  // --- Flat tiers (checked first, in order) ---
  for (const tier of rules.flatTiers ?? []) {
        const minOk = tier.minSubtotal === undefined || subtotal >= tier.minSubtotal;
        const maxOk = tier.maxSubtotal === undefined || subtotal <= tier.maxSubtotal;
        if (minOk && maxOk) {
                results.push({
                          service_name: tier.label,
                          service_code: 'WIDGETCO:STANDARD',
                          total_price: Math.round(tier.price * 100).toString(),
                          currency: 'USD',
                          description: tier.price === 0 ? 'Free shipping' : `Flat rate $${tier.price.toFixed(2)}`,
                });
                // Flat tier matched — return only this one rate
          return results;
        }
  }

  // --- Calculated tiers ---
  for (const tier of rules.calcTiers ?? []) {
        const minOk = tier.minSubtotal === undefined || subtotal >= tier.minSubtotal;
        const maxOk = tier.maxSubtotal === undefined || subtotal <= tier.maxSubtotal;
        if (minOk && maxOk) {
                const allowed = quotes.filter((q) =>
                          tier.carriers.some(
                                      (c) =>
                                                    q.serviceName.toLowerCase().includes(c.toLowerCase()) ||
                                                    q.carrier.toLowerCase().includes(c.toLowerCase())
                                    )
                                                    );
                if (allowed.length === 0) {
          console.warn(`[carrier] calcTier no matches for carriers=[${tier.carriers.join(',')}] — available serviceNames=[${quotes.map(q=>q.serviceName).join(',')}]`);
          continue; // no matching quotes — try next tier
        }
                if (tier.cheapestOnly) {
                          const cheapest = allowed.reduce((a, b) => (a.amountUsd <= b.amountUsd ? a : b));
                          const price = tier.overridePrice !== undefined ? tier.overridePrice : cheapest.amountUsd;
                          results.push({
                                      service_name: cheapest.serviceName,
                                      service_code: `${cheapest.carrier}:${cheapest.serviceCode}`,
                                      total_price: Math.round(price * 100).toString(),
                                      currency: cheapest.currency,
                                      description: price === 0 ? 'Free shipping' : `$${price.toFixed(2)}`,
                          });
                } else {
                          for (const q of allowed) {
                                      const price = tier.overridePrice !== undefined ? tier.overridePrice : q.amountUsd;
                                      results.push({
                                                    service_name: q.serviceName,
                                                    service_code: `${q.carrier}:${q.serviceCode}`,
                                                    total_price: Math.round(price * 100).toString(),
                                                    currency: q.currency,
                                                    description: price === 0 ? 'Free shipping' : `$${price.toFixed(2)}`,
                                      });
                          }
                }
      // All matching calc tiers are collected — no early return
        }
  }

  // --- Pass-through (Canada, AK/HI, Rest of World) ---
  if (rules.passThrough) {
        const alwaysSuppress = new Set((rules.suppressCarriers ?? []).map((s) => s.toLowerCase()));
        const suppressUsps =
                rules.suppressUspsOverSubtotal !== undefined && subtotal >= rules.suppressUspsOverSubtotal;

      for (const q of quotes) {
              const nameL = q.serviceName.toLowerCase();
              const carrierL = q.carrier.toLowerCase();
              const isUsps =
                        nameL.includes('usps') ||
                        carrierL.includes('usps') ||
                        nameL.includes('first class') ||
                        nameL.includes('priority mail') ||
                        nameL.includes('parcel select') ||
                        nameL.includes('ground advantage');

          if ([...alwaysSuppress].some((s) => nameL.includes(s) || carrierL.includes(s))) continue;
              if (isUsps && suppressUsps) continue;

          results.push({
                    service_name: q.serviceName,
                    service_code: `${q.carrier}:${q.serviceCode}`,
                    total_price: Math.round(q.amountUsd * 100).toString(),
                    currency: q.currency,
                    description: `$${q.amountUsd.toFixed(2)}`,
          });
      }
        return results;
  }

  return results;
}

// ---------------------------------------------------------------------------
// POST /carrier-service/rates (Shopify callback)
// ---------------------------------------------------------------------------
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
              provinceCode: rateReq?.destination?.province
                ? String(rateReq.destination.province)
                        : undefined,
              city: rateReq?.destination?.city ? String(rateReq.destination.city) : undefined,
              address1: rateReq?.destination?.address1
                ? String(rateReq.destination.address1)
                        : undefined,
      };

      // Order subtotal in USD — Shopify sends subtotal_price in cents as a string
      const subtotalCents = Number(rateReq?.subtotal_price ?? 0);
          const subtotal = subtotalCents / 100;

      const shipment = await buildShipment(lines, destination);
          const adapters = [new EasyPostAdapter()];
          const rawResults = await Promise.all(adapters.map((a) => a.getRates(shipment)));
          const quotes = rawResults.flat()
            .filter(q => q.amountUsd != null && !isNaN(q.amountUsd))
            .sort((a, b) => a.amountUsd - b.amountUsd);

      // Select zone rules
      let rules: ZoneRules;
          if (shipment.isDomestic && !shipment.isHiAkTerritory) {
                  rules = US_48_RULES; // 48 contiguous states
          } else if (shipment.isCanada) {
                  rules = CANADA_RULES;
          } else if (shipment.isHiAkTerritory) {
                  rules = AK_HI_TERRITORY_RULES;
          } else {
                  rules = REST_OF_WORLD_RULES;
          }

      console.log(`[carrier] pre-filter: subtotal=$${subtotal.toFixed(2)} quotes=${quotes.length} services=[${quotes.map(q=>q.serviceName).join(',')}]`);
    const rates = applyZoneRules(quotes, subtotal, rules);

      const zone =
              shipment.isDomestic && !shipment.isHiAkTerritory
              ? 'US48'
                : shipment.isCanada
              ? 'CA'
                : shipment.isHiAkTerritory
              ? 'AK/HI/TERR'
                : 'INTL';

      console.log(
              `[carrier] zone=${zone} subtotal=$${subtotal.toFixed(2)} easypostQuotes=${quotes.length} returnedRates=${rates.length} weight=${shipment.totalShipmentWeightLbs.toFixed(3)}lb`
            );

      res.json({ rates });
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
    const shop = process.env.SHOPIFY_SHOP;
    const appBaseUrl = (process.env.APP_BASE_URL ?? 'https://ship.widgetco.com').replace(/\/$/, '');

              if (!token || !shop) {
                    res.status(500).json({ error: 'SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_SHOP not set' });
                    return;
              }

              const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2024-01';
    const url = `https://${shop}/admin/api/${apiVersion}/carrier_services.json`;

              try {
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

      // service_discovery: false — prevents Shopify from auto-adding to all shipping zones
      const createRes = await fetch(url, {
              method: 'POST',
              headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                        carrier_service: {
                                    name: 'Precision Shipping',
                                    callback_url: `${appBaseUrl}/carrier-service/rates`,
                                    service_discovery: false,
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

/**
 * POST /api/carrier-service/fix-callback
 * Updates the registered carrier service callback URL to use APP_BASE_URL.
 */
router.post('/api/carrier-service/fix-callback', requireApprovedAdmin, async (req, res) => {
    const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    const shop = process.env.SHOPIFY_SHOP;
    const appBaseUrl = (process.env.APP_BASE_URL ?? 'https://ship.widgetco.com').replace(/\/$/, '');
    const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2024-01';

              if (!token || !shop) {
                    res.status(500).json({ error: 'SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_SHOP not set' });
                    return;
              }

              try {
                    const listRes = await fetch(
                            `https://${shop}/admin/api/${apiVersion}/carrier_services.json`,
                      { headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' } }
                          );
                    const listData: any = await listRes.json();
                    if (!listRes.ok) {
                            res.status(listRes.status).json({ error: 'List failed', details: listData });
                            return;
                    }

      const existing = (listData.carrier_services ?? []).find(
              (cs: any) => cs.name === 'Precision Shipping'
            );
                    if (!existing) {
                            res.status(404).json({ error: 'Precision Shipping carrier service not found' });
                            return;
                    }

      const updateRes = await fetch(
              `https://${shop}/admin/api/${apiVersion}/carrier_services/${existing.id}.json`,
        {
                  method: 'PUT',
                  headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                              carrier_service: { id: existing.id, callback_url: `${appBaseUrl}/carrier-service/rates` },
                  }),
        }
            );
                    const updateData: any = await updateRes.json();
                    if (!updateRes.ok) {
                            res.status(updateRes.status).json({ error: 'Update failed', details: updateData });
                            return;
                    }

      console.log('[carrier] Updated callback URL to:', updateData.carrier_service?.callback_url);
                    res.json({ ok: true, carrier_service: updateData.carrier_service });
              } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'Update failed' });
              }
});

export default router;
