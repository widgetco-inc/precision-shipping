import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';
import { env } from '../lib/env';

let _token: string | null = null;
let _tokenExpiry = 0;

async function getToken(): Promise<string> {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const credentials = Buffer.from(`${env.upsClientId}:${env.upsClientSecret}`).toString('base64');
  const resp = await fetch('https://onlinetools.ups.com/security/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials',
  });
  if (!resp.ok) throw new Error(`UPS auth failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json() as { access_token: string; expires_in: number };
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return _token;
}

// UPS service codes
const UPS_SERVICE_CODE: Record<string, string> = {
  GROUND:              '03',
  GROUND_SAVER:        '92',
  GROUND_SAVER_LIGHT:  '92',
  GROUND_SAVER_HEAVY:  '92',
  SECOND_DAY_AIR:      '02',
  NEXT_DAY_AIR:        '01',
};

// Route each service code to the correct shipper account number
function accountForService(serviceCode: string): string {
  if (serviceCode === 'GROUND')                                               return env.upsGroundAccount;
  if (serviceCode === 'SECOND_DAY_AIR')                                       return env.ups2DayAccount;
  if (['GROUND_SAVER', 'GROUND_SAVER_LIGHT', 'GROUND_SAVER_HEAVY'].includes(serviceCode)) return env.upsGroundSaverAccount;
  return env.upsGroundAccount; // fallback
}

async function fetchUPSRate(
  serviceCode: string,
  shipment: Shipment,
  token: string,
  shipperNumber: string,
): Promise<number | null> {
  const upsCode = UPS_SERVICE_CODE[serviceCode];
  if (!upsCode) return null;

  const weightLb = Math.max(shipment.totalShipmentWeightLbs, 0.1).toFixed(2);
  const dest = shipment.destination;

  const body = {
    RateRequest: {
      Request: { RequestOption: 'Rate' },
      Shipment: {
        Shipper: {
          ShipperNumber: shipperNumber,
          Address: {
            AddressLine: [env.originAddress],
            City: env.originCity,
            StateProvinceCode: env.originState,
            PostalCode: env.originZip,
            CountryCode: 'US',
          },
        },
        ShipTo: {
          Address: {
            AddressLine: [dest.address1 ?? ''],
            City: dest.city ?? '',
            StateProvinceCode: dest.provinceCode ?? '',
            PostalCode: dest.postalCode ?? '',
            CountryCode: dest.countryCode,
          },
        },
        ShipFrom: {
          Address: {
            AddressLine: [env.originAddress],
            City: env.originCity,
            StateProvinceCode: env.originState,
            PostalCode: env.originZip,
            CountryCode: 'US',
          },
        },
        Service: { Code: upsCode },
        Package: {
          PackagingType: { Code: '02' },
          PackageWeight: {
            UnitOfMeasurement: { Code: 'LBS' },
            Weight: weightLb,
          },
        },
      },
    },
  };

  const resp = await fetch('https://onlinetools.ups.com/api/rating/v2205/Rate', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.warn(`[ups] Rate request failed for ${serviceCode} (acct ${shipperNumber.slice(0,2)}**): ${resp.status}`);
    return null;
  }

  const data = await resp.json() as any;
  const charge = data?.RateResponse?.RatedShipment?.TotalCharges?.MonetaryValue;
  return charge != null ? parseFloat(charge) : null;
}

export class UpsAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    const settings = getSettings().carriers.ups;
    if (!settings.enabled) return [];

    if (!env.upsClientId || !env.upsClientSecret) {
      console.warn('[ups] Missing OAuth credentials — skipping live rates');
      return [];
    }

    // UPS domestic only
    if (!shipment.isDomestic) return [];

    let token: string;
    try {
      token = await getToken();
    } catch (err) {
      console.error('[ups] Token error:', err);
      return [];
    }

    const eligible = settings.services.filter((svc) => {
      if (!svc.enabled) return false;
      if (svc.domesticOnly && !shipment.isDomestic) return false;
      // For HI/AK don't show Ground Saver
      if (shipment.isHiAkTerritory && ['GROUND_SAVER', 'GROUND_SAVER_LIGHT', 'GROUND_SAVER_HEAVY'].includes(svc.code)) return false;
      if (svc.maxWeightLb != null && shipment.totalShipmentWeightLbs > svc.maxWeightLb) return false;
      if (svc.minWeightLb != null && shipment.totalShipmentWeightLbs < svc.minWeightLb) return false;
      return true;
    });

    const quotes: RateQuote[] = [];
    for (const svc of eligible) {
      const shipperNumber = accountForService(svc.code);
      if (!shipperNumber) {
        console.warn(`[ups] No account number configured for service ${svc.code} — skipping`);
        continue;
      }
      try {
        const rate = await fetchUPSRate(svc.code, shipment, token, shipperNumber);
        if (rate == null) continue;
        const total = rate + (svc.handlingFeeUsd ?? 0);
        quotes.push({
          carrier: 'ups',
          serviceCode: svc.code,
          serviceName: svc.label,
          amountUsd: Number(total.toFixed(2)),
          currency: 'USD',
          debug: [
            `weightLb=${shipment.totalShipmentWeightLbs.toFixed(3)}`,
            `service=${svc.code}`,
            `acct=${shipperNumber.slice(0,2)}**`,
            'rateSource=ups-live',
          ],
        });
      } catch (err) {
        console.error(`[ups] Rate error for ${svc.code}:`, err);
      }
    }
    return quotes;
  }
}
