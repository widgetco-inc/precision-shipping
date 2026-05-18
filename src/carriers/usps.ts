import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';
import { env } from '../lib/env';

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const resp = await fetch('https://api.usps.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.uspsClientId,
      client_secret: env.uspsClientSecret,
    }),
  });
  if (!resp.ok) throw new Error(`USPS auth failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

async function fetchUSPSDomesticRate(
  mailClass: string,
  shipment: Shipment,
  token: string
): Promise<number | null> {
  const weightLb = Math.max(shipment.totalShipmentWeightLbs, 0.01);
  const params = new URLSearchParams({
    originZIPCode: env.originZip,
    destinationZIPCode: shipment.destination.postalCode ?? '10001',
    weight: weightLb.toFixed(3),
    length: '6', width: '4', height: '2',
    mailClass,
    processingCategory: 'NON_MACHINABLE',
    destinationEntryFacilityType: 'NONE',
    priceType: 'COMMERCIAL',
  });

  const resp = await fetch(
    `https://api.usps.com/prices/v3/base-rates/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    console.warn(`[usps] Domestic rate failed for ${mailClass}: ${resp.status}`);
    return null;
  }

  const data = await resp.json() as any;
  const prices: any[] = data?.prices ?? [];
  if (!prices.length) return null;
  return parseFloat(prices.sort((a: any, b: any) => a.price - b.price)[0].price);
}

async function fetchUSPSInternationalRate(
  shipment: Shipment,
  token: string
): Promise<number | null> {
  const weightLb = Math.max(shipment.totalShipmentWeightLbs, 0.01);
  const params = new URLSearchParams({
    originZIPCode: env.originZip,
    destinationCountryCode: shipment.destination.countryCode,
    weight: weightLb.toFixed(3),
    length: '6', width: '4', height: '2',
    mailClass: 'FIRST-CLASS_PACKAGE_INTERNATIONAL_SERVICE',
    processingCategory: 'NON_MACHINABLE',
    destinationEntryFacilityType: 'NONE',
    priceType: 'COMMERCIAL',
  });

  const resp = await fetch(
    `https://api.usps.com/international-prices/v3/base-rates/search?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!resp.ok) {
    console.warn(`[usps] International rate failed: ${resp.status}`);
    return null;
  }

  const data = await resp.json() as any;
  const prices: any[] = data?.prices ?? [];
  if (!prices.length) return null;
  return parseFloat(prices.sort((a: any, b: any) => a.price - b.price)[0].price);
}

const MAIL_CLASS_MAP: Record<string, string> = {
  GROUND_ADVANTAGE: 'USPS_GROUND_ADVANTAGE',
  PRIORITY_MAIL:    'PRIORITY_MAIL',
};

export class UspsAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    const settings = getSettings().carriers.usps;
    if (!settings.enabled) return [];

    if (!env.uspsClientId || !env.uspsClientSecret) {
      console.warn('[usps] Missing credentials — skipping live rates');
      return [];
    }

    let token: string;
    try {
      token = await getToken();
    } catch (err) {
      console.error('[usps] Token error:', err);
      return [];
    }

    const eligible = settings.services.filter((svc) => {
      if (!svc.enabled) return false;
      if (svc.domesticOnly && !shipment.isDomestic) return false;
      if (svc.internationalOnly && shipment.isDomestic) return false;
      if (svc.maxWeightLb != null && shipment.totalShipmentWeightLbs > svc.maxWeightLb) return false;
      return true;
    });

    const quotes: RateQuote[] = [];
    for (const svc of eligible) {
      try {
        let rate: number | null = null;
        if (svc.code === 'INTERNATIONAL_MAIL') {
          rate = await fetchUSPSInternationalRate(shipment, token);
        } else {
          const mailClass = MAIL_CLASS_MAP[svc.code];
          if (!mailClass) continue;
          rate = await fetchUSPSDomesticRate(mailClass, shipment, token);
        }
        if (rate == null) continue;
        const total = rate + (svc.handlingFeeUsd ?? 0);
        quotes.push({
          carrier: 'usps',
          serviceCode: svc.code,
          serviceName: svc.label,
          amountUsd: Number(total.toFixed(2)),
          currency: 'USD',
          debug: [
            `weightLb=${shipment.totalShipmentWeightLbs.toFixed(3)}`,
            `service=${svc.code}`,
            'rateSource=usps-live',
          ],
        });
      } catch (err) {
        console.error(`[usps] Rate error for ${svc.code}:`, err);
      }
    }
    return quotes;
  }
}
