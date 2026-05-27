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
// addBusinessDays
// Adds N business days (Mon-Fri) to a given date, skipping weekends.
// ---------------------------------------------------------------------------
function addBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// formatDeliveryDate
// Formats a Date as "Thu, May 29"
// ---------------------------------------------------------------------------
function formatDeliveryDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Chicago',
  });
}

// ---------------------------------------------------------------------------
// buildDescription
// Returns a description string with estimated delivery date and cutoff message.
// transitDays: number of business days in transit.
//
// Format examples:
//   "Thu, May 29 - Order by 4 PM CST to ship today"
//   "Mon, Jun 2 - Ships next business day"
// ---------------------------------------------------------------------------
function buildDescription(transitDays: number): string {
  const now = new Date();
  const chicagoTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  const day = chicagoTime.getDay();   // 0=Sun, 6=Sat
  const hour = chicagoTime.getHours();
  const isWeekday = day >= 1 && day <= 5;
  const beforeCutoff = hour < 16; // before 4:00 PM

  const shipsToday = isWeekday && beforeCutoff;

  // Ship date: today if before cutoff on a weekday, otherwise next business day
  let shipDate: Date;
  if (shipsToday) {
    shipDate = new Date(chicagoTime);
  } else {
    shipDate = new Date(chicagoTime);
    shipDate.setDate(shipDate.getDate() + 1);
    while (shipDate.getDay() === 0 || shipDate.getDay() === 6) {
      shipDate.setDate(shipDate.getDate() + 1);
    }
  }

  // Delivery date = ship date + transitDays business days
  const deliveryDate = addBusinessDays(shipDate, transitDays);
  const deliveryStr = formatDeliveryDate(deliveryDate);

  const cutoffMsg = shipsToday ? 'Order by 4 PM CST to ship today' : 'Ships next business day';
  return deliveryStr + ' - ' + cutoffMsg;
}

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
      // Standard Delivery flat tier: default to USPS Ground Advantage = 5 business days
      const transitDays = 5;
      results.push({
        service_name: tier.label,
        service_code: 'WIDGETCO:STANDARD',
        total_price: Math.round(tier.price * 100).toString(),
        currency: 'USD',
        description: buildDescription(transitDays),
      });
      // Flat tier matched - return only this one rate
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
        console.warn('[carrier] calcTier no matches for carriers=[' + tier.carriers.join(',') + '] - available serviceNames=[' + quotes.map(q => q.serviceName).join(',') + ']');
        continue;
      }
      if (tier.cheapestOnly) {
        const cheapest = allowed.reduce((a, b) => (a.amountUsd <= b.amountUsd ? a : b));
        const price = tier.overridePrice !== undefined ? tier.overridePrice : cheapest.amountUsd;
        // Use EasyPost estDeliveryDays if available, otherwise fall back to 5
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
          // Use EasyPost estDeliveryDays if available, otherwise fall back to 3
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

    for (const q of quotes) {
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
    services: [
      { name: 'Standard Delivery', code: 'WIDGETCO:STANDARD' },
      { name: 'FedEx Ground', code: 'fedex:FEDEX_GROUND' },
      { name: 'UPS Ground', code: 'ups:UPS_GROUND' },
      { name: 'FedEx 2Day', code: 'fedex:FEDEX_2_DAY' },
      { name: 'FedEx Standard Overnight', code: 'fedex:STANDARD_OVERNIGHT' },
      { name: 'FedEx Priority Overnight', code: 'fedex:PRIORITY_OVERNIGHT' },
    ],
  });
});

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

    // Calculate subtotal from line item prices (Shopify sends price in cents as a string).
    // We do NOT use subtotal_price from the payload — Shopify sends it as 0 and it is unreliable.
    const subtotal = items.reduce((sum: number, item: any) => {
      const priceCents = Number(item.price ?? 0);       // cents
      const qty = Number(item.quantity ?? 1);
      return sum + (priceCents * qty);
    }, 0) / 100;

    const shipment = await buildShipment(lines, destination);
    const adapters = [new EasyPostAdapter()];
    const rawResults = await Promise.all(adapters.map((a) => a.getRates(shipment)));
    const quotes = rawResults.flat()
      .filter(q => q.amountUsd != null && !isNaN(q.amountUsd))
      .sort((a, b) => a.amountUsd - b.amountUsd);

    // Select zone rules
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

    console.log('[carrier] pre-filter: subtotal=$' + subtotal.toFixed(2) + ' quotes=' + quotes.length + ' services=[' + quotes.map(q => q.serviceName).join(',') + ']');
    const rates = applyZoneRules(quotes, subtotal, rules);

    const zone =
      shipment.isDomestic && !shipment.isHiAkTerritory
        ? 'US48'
        : shipment.isCanada
        ? 'CA'
        : shipment.isHiAkTerritory
        ? 'AK/HI/TERR'
        : 'INTL';

    console.log('[carrier] zone=' + zone + ' subtotal=$' + subtotal.toFixed(2) + ' easypostQuotes=' + quotes.length + ' returnedRates=' + rates.length + ' weight=' + shipment.totalShipmentWeightLbs.toFixed(3) + 'lb');

    res.json({ rates });
  } catch (err) {
    console.error('[carrier] Rate callback error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/carrier-service/register
// One-time admin call to register this app as a Shopify carrier service.
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
// Updates the registered carrier service callback URL to use APP_BASE_URL.
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
