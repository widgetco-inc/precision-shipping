import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';
import { env } from '../lib/env';

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const resp = await fetch('https://apis.fedex.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.fedexClientId,
      client_secret: env.fedexClientSecret,
    }),
  });
  if (!resp.ok) throw new Error(`FedEx auth failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

// Map our service codes to FedEx API service types
const SERVICE_TYPE_MAP: Record<string, string> = {
  FEDEX_GROUND:             'FEDEX_GROUND',
  GROUND_HOME_DELIVERY:     'GROUND_HOME_DELIVERY',
  FEDEX_2_DAY:              'FEDEX_2_DAY',
  PRIORITY_OVERNIGHT:       'PRIORITY_OVERNIGHT',
  STANDARD_OVERNIGHT:       'STANDARD_OVERNIGHT',
  INTERNATIONAL_GROUND_CA:  'FEDEX_GROUND',
  INTERNATIONAL_PRIORITY:   'INTERNATIONAL_PRIORITY',
  INTERNATIONAL_ECONOMY:    'INTERNATIONAL_ECONOMY',
  INTERNATIONAL_CONNECT_PLUS: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
};

async function fetchFedExRate(
  serviceCode: string,
  shipment: Shipment,
  token: string
): Promise<number | null> {
  const serviceType = SERVICE_TYPE_MAP[serviceCode];
  if (!serviceType) return null;

  const weightKg = Math.max(shipment.heaviestBoxWeightLb * 0.453592, 0.1);
  const dest = shipment.destination;

  const body = {
    accountNumber: { value: env.fedexAccountNumber },
    requestedShipment: {
      shipper: {
        address: {
          streetLines: [env.originAddress],
          city: env.originCity,
          stateOrProvinceCode: env.originState,
          postalCode: env.originZip,
          countryCode: 'US',
        },
      },
      recipient: {
        address: {
          streetLines: [dest.address1 ?? ''],
          city: dest.city ?? '',
          stateOrProvinceCode: dest.provinceCode ?? '',
          postalCode: dest.postalCode ?? '',
          countryCode: dest.countryCode,
          residential: false,
        },
      },
      serviceType,
      packagingType: 'YOUR_PACKAGING',
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      rateRequestType: ['ACCOUNT'],
      requestedPackageLineItems: [
        {
          weight: { units: 'KG', value: weightKg.toFixed(3) },
        },
      ],
    },
  };

  const resp = await fetch('https://apis.fedex.com/rate/v1/rates/quotes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.warn(`[fedex] Rate request failed for ${serviceCode}: ${resp.status}`);
    return null;
  }

  const data = await resp.json() as any;
  const netCharge =
    data?.output?.rateReplyDetails?.[0]?.ratedShipmentDetails?.[0]?.totalNetCharge;
  return netCharge != null ? parseFloat(netCharge) : null;
}

export class FedexAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    const settings = getSettings().carriers.fedex;
    if (!settings.enabled) return [];

    // Skip if no credentials configured
    if (!env.fedexClientId || !env.fedexClientSecret || !env.fedexAccountNumber) {
      console.warn('[fedex] Missing credentials — skipping live rates');
      return [];
    }

    let token: string;
    try {
      token = await getToken();
    } catch (err) {
      console.error('[fedex] Token error:', err);
      return [];
    }

    const eligible = settings.services.filter((svc) => {
      if (!svc.enabled) return false;
      if (svc.domesticOnly && !shipment.isDomestic) return false;
      if (svc.internationalOnly && !shipment.isInternational && !shipment.isCanada) return false;
      if (svc.canadaOnly && !shipment.isCanada) return false;
      if (svc.maxWeightLb != null && shipment.heaviestBoxWeightLb > svc.maxWeightLb) return false;
      if (svc.minWeightLb != null && shipment.heaviestBoxWeightLb < svc.minWeightLb) return false;
      return true;
    });

    const quotes: RateQuote[] = [];
    for (const svc of eligible) {
      try {
        const rate = await fetchFedExRate(svc.code, shipment, token);
        if (rate == null) continue;
        const total = (rate * shipment.numberOfBoxes) + (svc.handlingFeeUsd ?? 0);
        quotes.push({
          carrier: 'fedex',
          serviceCode: svc.code,
          serviceName: svc.label,
          amountUsd: Number(total.toFixed(2)),
          currency: 'USD',
          debug: [
            `weightLb=${shipment.heaviestBoxWeightLb.toFixed(3)}`,
            `service=${svc.code}`,
            'rateSource=fedex-live',
          ],
        });
      } catch (err) {
        console.error(`[fedex] Rate error for ${svc.code}:`, err);
      }
    }
    return quotes;
  }
}
