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

// All service codes this app can return - used for Shopify service discovery
const ALL_SERVICES = [
      { service_name: 'Standard Delivery',                    service_code: 'WIDGETCO:STANDARD',              total_price: '0', currency: 'USD', description: '3-5 business days' },
      { service_name: 'FedEx Ground',                         service_code: 'fedex:FEDEX_GROUND',             total_price: '0', currency: 'USD', description: '3-4 business days' },
      { service_name: 'FedEx 2Day',                           service_code: 'fedex:FEDEX_2_DAY',              total_price: '0', currency: 'USD', description: '2 business days' },
      { service_name: 'FedEx Standard Overnight',             service_code: 'fedex:STANDARD_OVERNIGHT',       total_price: '0', currency: 'USD', description: '1 business day' },
      { service_name: 'FedEx Priority Overnight',             service_code: 'fedex:PRIORITY_OVERNIGHT',       total_price: '0', currency: 'USD', description: '1 business day' },
      { service_name: 'FedEx International Ground (Canada)',  service_code: 'fedex:INTERNATIONAL_GROUND_CA',  total_price: '0', currency: 'USD', description: 'Estimated delivery varies' },
      { service_name: 'FedEx International Priority Express', service_code: 'fedex:INTERNATIONAL_PRIORITY',   total_price: '0', currency: 'USD', description: 'Estimated delivery varies' },
      { service_name: 'FedEx International Economy Express',  service_code: 'fedex:INTERNATIONAL_ECONOMY',    total_price: '0', currency: 'USD', description: 'Estimated delivery varies' },
      { service_name: 'FedEx International Connect Plus',     service_code: 'fedex:INTERNATIONAL_CONNECT_PLUS', total_price: '0', currency: 'USD', description: 'Estimated delivery varies' },
      { service_name: 'USPS Ground Advantage',                service_code: 'usps:GROUND_ADVANTAGE',          total_price: '0', currency: 'USD', description: '2-5 business days' },
      { service_name: 'USPS International Mail',              service_code: 'usps:INTERNATIONAL_MAIL',        total_price: '0', currency: 'USD', description: 'Estimated delivery varies' },
      ];

// ---------------------------------------------------------------------------
// nextShipDate
// Returns the next business day we can ship (Monday–Friday).
// If today is a weekday and before 4 PM CST, we ship today.
// Otherwise we ship the next weekday.
// ---------------------------------------------------------------------------
function nextShipDate(): Date {
        // Get current time in CST/CDT using UTC offset
  // America/Chicago is UTC-6 (CST) or UTC-5 (CDT).
  // We use toLocaleString to extract the local wall-clock time safely.
  const nowUtc = new Date();
        const cstString = nowUtc.toLocaleString('en-US', { timeZone: 'America/Chicago' });
        const cst = new Date(cstString);

  const day = cst.getDay();   // 0=Sun, 1=Mon … 6=Sat
  const hour = cst.getHours();
        const minute = cst.getMinutes();
        const isWeekday = day >= 1 && day <= 5;
        const beforeCutoff = hour < 16; // before 4 PM CST

  // Start with today's date in CST (year/month/day only, no time component)
  // We build a plain UTC midnight date so arithmetic is safe.
  const year = cst.getFullYear();
        const month = cst.getMonth();
        const date = cst.getDate();
        let shipDay = new Date(Date.UTC(year, month, date));

  if (isWeekday && beforeCutoff) {
            // Ships today — shipDay is already correct
  } else {
            // Advance to next calendar day first, then skip past weekends
          shipDay.setUTCDate(shipDay.getUTCDate() + 1);
            const d = shipDay.getUTCDay();
            if (d === 0) shipDay.setUTCDate(shipDay.getUTCDate() + 1); // Sun → Mon
          if (d === 6) shipDay.setUTCDate(shipDay.getUTCDate() + 2); // Sat → Mon
  }

  return shipDay;
}

// ---------------------------------------------------------------------------
// addBusinessDays — adds N weekdays to a UTC-midnight date
// ---------------------------------------------------------------------------
function addBusinessDays(date: Date, days: number): Date {
        const result = new Date(date);
        let added = 0;
        while (added < days) {
                  result.setUTCDate(result.getUTCDate() + 1);
                  const dow = result.getUTCDay();
                  if (dow !== 0 && dow !== 6) added++;
        }
        return result;
}

// ---------------------------------------------------------------------------
// formatDeliveryDate — e.g. "Tue, Jun 3"
// ---------------------------------------------------------------------------
function formatDeliveryDate(utcDate: Date): string {
        return utcDate.toLocaleDateString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
        });
}

// ---------------------------------------------------------------------------
// buildDescription
// Returns just the estimated delivery date string, e.g. "Tue, Jun 3"
// No "Ships next business day" messaging.
// ---------------------------------------------------------------------------
function buildDescription(transitDays: number): string {
        const shipDate = nextShipDate();
        const deliveryDate = addBusinessDays(shipDate, transitDays);
        return formatDeliveryDate(deliveryDate);
}

// ---------------------------------------------------------------------------
// uspsGroundTransitDays
// ---------------------------------------------------------------------------
function uspsGroundTransitDays(allQuotes: RateQuote[]): number {
        const uspsGround = allQuotes.find((q) => {
                  const name = q.serviceName.toLowerCase();
                  const carrier = q.carrier.toLowerCase();
                  return (
                              (name.includes('ground advantage') || name.includes('ground_advantage')) ||
                              (carrier.includes('usps') && name.includes('ground'))
                            );
        });
        if (uspsGround && uspsGround.estDeliveryDays != null && uspsGround.estDeliveryDays > 0) {
                  return uspsGround.estDeliveryDays;
        }
        return 5;
}

// ---------------------------------------------------------------------------
// applyZoneRules
// Flat tiers set the ground/standard rate but do NOT prevent express tiers
// from also being returned. Express calcTiers always run regardless of flat tiers.
// ---------------------------------------------------------------------------
function applyZoneRules(
        allQuotes: RateQuote[],
        filteredQuotes: RateQuote[],
        subtotal: number,
        rules: ZoneRules
      ): Array<{ service_name: string; service_code: string; total_price: string; currency: string; description: string }> {
        const results: Array<{ service_name: string; service_code: string; total_price: string; currency: string; description: string }> = [];

  // --- Flat tiers (first match wins for ground/standard rate) ---
  // Note: does NOT return early — express calcTiers still run below.
  for (const tier of rules.flatTiers ?? []) {
            const minOk = tier.minSubtotal === undefined || subtotal >= tier.minSubtotal;
            const maxOk = tier.maxSubtotal === undefined || subtotal <= tier.maxSubtotal;
            if (minOk && maxOk) {
                        const transitDays = uspsGroundTransitDays(allQuotes);
                        results.push({
                                      service_name: tier.label,
                                      service_code: 'WIDGETCO:STANDARD',
                                      total_price: Math.round(tier.price * 100).toString(),
                                      currency: 'USD',
                                      description: buildDescription(transitDays),
                        });
                        break; // Only one flat tier matches, but continue to calcTiers below
            }
  }

  // --- Calculated tiers ---
  for (const tier of rules.calcTiers ?? []) {
            const minOk = tier.minSubtotal === undefined || subtotal >= tier.minSubtotal;
            const maxOk = tier.maxSubtotal === undefined || subtotal <= tier.maxSubtotal;
            if (minOk && maxOk) {
                        const allowed = filteredQuotes.filter((q) =>
                                      tier.carriers.some(
                                                      (c) =>
                                                                        q.serviceName.toLowerCase().includes(c.toLowerCase()) ||
                                                                        q.carrier.toLowerCase().includes(c.toLowerCase())
                                                    )
                                                                    );
                        if (allowed.length === 0) {
                                      console.warn('[carrier] calcTier no matches for carriers=[' + tier.carriers.join(',') + '] - available serviceNames=[' + filteredQuotes.map(q => q.serviceName).join(',') + ']');
                                      continue;
                        }
                        if (tier.cheapestOnly) {
                                      const cheapest = allowed.reduce((a, b) => (a.amountUsd <= b.amountUsd ? a : b));
                                      const price = tier.overridePrice !== undefined ? tier.overridePrice : cheapest.amountUsd;
                                      const transitDays = (cheapest.estDeliveryDays != null && cheapest.estDeliveryDays > 0)
                                        ? cheapest.estDeliveryDays
                                                      : 5;
                                      results.push({
                                                      service_name: cheapest.serviceName,
                                                      service_code: cheapest.carrier + ':' + cheapest.serviceCode,
                                                      total_price: Math.round(price * 100).toString(),
                                                      currency: cheapest.currency,
                                                      description: buildDescription(transitDays),
                                      });
                        } else {
                                      for (const q of allowed) {
                                                      const price = tier.overridePrice !== undefined ? tier.overridePrice : q.amountUsd;
                                                      const transitDays = (q.estDeliveryDays != null && q.estDeliveryDays > 0)
                                                        ? q.estDeliveryDays
                                                                        : 3;
                                                      results.push({
                                                                        service_name: q.serviceName,
                                                                        service_code: q.carrier + ':' + q.serviceCode,
                                                                        total_price: Math.round(price * 100).toString(),
                                                                        currency: q.currency,
                                                                        description: buildDescription(transitDays),
                                                      });
                                      }
                        }
            }
  }

  // --- Pass-through (Canada, AK/HI, Rest of World) ---
  if (rules.passThrough) {
            const alwaysSuppress = new Set((rules.suppressCarriers ?? []).map((s) => s.toLowerCase()));
            const suppressUsps =
                        rules.suppressUspsOverSubtotal !== undefined && subtotal >= rules.suppressUspsOverSubtotal;

          for (const q of allQuotes) {
                      const nameL = q.serviceName.toLowerCase();
                      const carrierL = q.carrier.toLowerCase();
                      const isUsps = nameL.includes('usps') || carrierL.includes('usps') ||
                                    nameL.includes('first class') || nameL.includes('priority mail') ||
                                    nameL.includes('parcel select') || nameL.includes('ground advantage');

              if ([...alwaysSuppress].some((s) => nameL.includes(s) || carrierL.includes(s))) continue;
                      if (isUsps && suppressUsps) continue;

              const transitDays = (q.estDeliveryDays != null && q.estDeliveryDays > 0)
                        ? q.estDeliveryDays
                            : 5;
                      results.push({
                                    service_name: q.serviceName,
                                    service_code: q.carrier + ':' + q.serviceCode,
                                    total_price: Math.round(q.amountUsd * 100).toString(),
                                    currency: q.currency,
                                    description: buildDescription(transitDays),
                      });
          }
            return results;
  }

  return results;
}

// ---------------------------------------------------------------------------
// GET /carrier-service/rates (Shopify service discovery)
// ---------------------------------------------------------------------------
router.get('/carrier-service/rates', (_req, res) => {
        res.json({
                  services: ALL_SERVICES.map(s => ({ name: s.service_name, code: s.service_code })),
        });
});

// ---------------------------------------------------------------------------
// POST /carrier-service/rates (Shopify callback)
// ---------------------------------------------------------------------------
router.post('/carrier-service/rates', async (req, res) => {
        try {
                  const rateReq = req.body?.rate;
                  const items = Array.isArray(rateReq?.items) ? rateReq.items : [];

          // Shopify service discovery: called with empty items array to enumerate services.
          if (items.length === 0) {
                      console.log('[carrier] Service discovery call (empty items) - returning all services');
                      res.json({ rates: ALL_SERVICES });
                      return;
          }

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

          const subtotal = items.reduce((sum: number, item: any) => {
                      const linePriceCents = Number(item.line_price ?? (Number(item.price ?? 0) * Number(item.quantity ?? 1)));
                      return sum + linePriceCents;
          }, 0) / 100;

          const shipment = await buildShipment(lines, destination);
                  const adapters = [new EasyPostAdapter()];
                  const rawResults = await Promise.all(adapters.map((a) => a.getRates(shipment)));

          const allQuotes = rawResults.flat()
                    .filter(q => q.amountUsd != null && !isNaN(q.amountUsd))
                    .sort((a, b) => a.amountUsd - b.amountUsd);

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

          const suppressSet = new Set((rules.suppressCarriers ?? []).map((s: string) => s.toLowerCase()));
                  const filteredQuotes = allQuotes.filter((q) => {
                              const nameL = q.serviceName.toLowerCase();
                              const carrierL = q.carrier.toLowerCase();
                              return ![...suppressSet].some((s) => nameL.includes(s) || carrierL.includes(s));
                  });

          console.log('[carrier] pre-filter: subtotal=$' + subtotal.toFixed(2) + ' quotes=' + allQuotes.length + ' services=[' + allQuotes.map(q => q.serviceName).join(',') + ']');
                  const rates = applyZoneRules(allQuotes, filteredQuotes, subtotal, rules);

          const zone =
                      shipment.isDomestic && !shipment.isHiAkTerritory
                      ? 'US48'
                        : shipment.isCanada
                      ? 'CA'
                        : shipment.isHiAkTerritory
                      ? 'AK/HI/TERR'
                        : 'INTL';

          console.log('[carrier] zone=' + zone + ' subtotal=$' + subtotal.toFixed(2) + ' easypostQuotes=' + allQuotes.length + ' returnedRates=' + rates.length + ' weight=' + shipment.totalShipmentWeightLbs.toFixed(3) + 'lb');

          res.json({ rates });
        } catch (err) {
                  console.error('[carrier] Rate callback error:', err);
                  res.status(500).json({ error: 'Internal server error' });
        }
});

// ---------------------------------------------------------------------------
// POST /api/carrier-service/register
// ---------------------------------------------------------------------------
router.post('/api/carrier-service/register', requireApprovedAdmin, async (req, res) => {
        const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
        const shop = process.env.SHOPIFY_SHOP;
        const appBaseUrl = (process.env.APP_BASE_URL ?? 'https://ship.widgetco.com').replace(/\/$/, '');

              if (!token || !shop) {
                        res.status(500).json({ error: 'SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_SHOP not set' });
                        return;
              }

              const apiVersion = process.env.SHOPIFY_API_VERSION ?? '2024-01';
        const url = 'https://' + shop + '/admin/api/' + apiVersion + '/carrier_services.json';

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
                                    await fetch('https://' + shop + '/admin/api/' + apiVersion + '/carrier_services/' + existing.id + '.json', {
                                                  method: 'DELETE',
                                                  headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                                    });
                                    console.log('[carrier] Deleted for re-registration:', existing.id);
                        }

          const createRes = await fetch(url, {
                      method: 'POST',
                      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                                    carrier_service: {
                                                    name: 'Precision Shipping',
                                                    callback_url: appBaseUrl + '/carrier-service/rates',
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

// ---------------------------------------------------------------------------
// POST /api/carrier-service/fix-callback
// ---------------------------------------------------------------------------
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
                                    'https://' + shop + '/admin/api/' + apiVersion + '/carrier_services.json',
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
                      'https://' + shop + '/admin/api/' + apiVersion + '/carrier_services/' + existing.id + '.json',
                {
                              method: 'PUT',
                              headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                              carrier_service: { id: existing.id, callback_url: appBaseUrl + '/carrier-service/rates' },
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
