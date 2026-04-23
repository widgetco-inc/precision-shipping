import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';
import { env } from '../lib/env';

// EasyPost carrier account IDs mapped to our carrier setting keys
const CARRIER_ACCOUNTS = {
  fedex:  'ca_544bae948c20483c947448953a736823',
  ups:    'ca_5065a768022845f89a3e646a6eafa19b',
  ups_f:  'ca_61b89a3dcdaa4c8b8acd96e595c2de91',
  usps:   'ca_2046b502461e4ad68b6cf6c0f0f9843b',
};

const SERVICE_MAP: Record<string, { carrier: string; service: string }> = {
  FEDEX_GROUND:               { carrier: 'FedEx', service: 'FEDEX_GROUND' },
  GROUND_HOME_DELIVERY:       { carrier: 'FedEx', service: 'GROUND_HOME_DELIVERY' },
  FEDEX_2_DAY:                { carrier: 'FedEx', service: 'FEDEX_2_DAY' },
  PRIORITY_OVERNIGHT:         { carrier: 'FedEx', service: 'PRIORITY_OVERNIGHT' },
  STANDARD_OVERNIGHT:         { carrier: 'FedEx', service: 'STANDARD_OVERNIGHT' },
  INTERNATIONAL_GROUND_CA:    { carrier: 'FedEx', service: 'FEDEX_GROUND' },
  INTERNATIONAL_PRIORITY:     { carrier: 'FedEx', service: 'INTERNATIONAL_PRIORITY' },
  INTERNATIONAL_ECONOMY:      { carrier: 'FedEx', service: 'INTERNATIONAL_ECONOMY' },
  INTERNATIONAL_CONNECT_PLUS: { carrier: 'FedEx', service: 'FEDEX_INTERNATIONAL_CONNECT_PLUS' },
  GROUND:                     { carrier: 'UPS',   service: 'Ground' },
  SECOND_DAY_AIR:             { carrier: 'UPS',   service: '2ndDayAir' },
  GROUND_SAVER_LIGHT:         { carrier: 'UPS',   service: 'GroundSaver' },
  GROUND_SAVER_HEAVY:         { carrier: 'UPS',   service: 'GroundSaver' },
  GROUND_ADVANTAGE:           { carrier: 'USPS',  service: 'GroundAdvantage' },
  PRIORITY_MAIL:              { carrier: 'USPS',  service: 'Priority' },
  INTERNATIONAL_MAIL:         { carrier: 'USPS',  service: 'FirstClassMailInternational' },
};

function accountIdForService(serviceCode: string): string {
  if (serviceCode === 'GROUND_SAVER_LIGHT' || serviceCode === 'GROUND_SAVER_HEAVY') {
    return CARRIER_ACCOUNTS.ups_f;
  }
  const info = SERVICE_MAP[serviceCode];
  if (!info) return '';
  if (info.carrier === 'FedEx') return CARRIER_ACCOUNTS.fedex;
  if (info.carrier === 'UPS')   return CARRIER_ACCOUNTS.ups;
  if (info.carrier === 'USPS')  return CARRIER_ACCOUNTS.usps;
  return '';
}

function internalCarrierKey(serviceCode: string): string {
  const info = SERVICE_MAP[serviceCode];
  if (!info) return 'unknown';
  if (info.carrier === 'FedEx') return 'fedex';
  if (info.carrier === 'UPS')   return 'ups';
  if (info.carrier === 'USPS')  return 'usps';
  return 'unknown';
}

async function getEasyPostRate(
  serviceCode: string,
  shipment: Shipment,
): Promise<number | null> {
  if (!env.easypostApiKey) return null;
  const info = SERVICE_MAP[serviceCode];
  if (!info) return null;
  const accountId = accountIdForService(serviceCode);
  if (!accountId) return null;

  const weightOz = Math.max(shipment.totalShipmentWeightLb * 16, 0.1);
  const dest = shipment.destination;

  const body = {
    shipment: {
      from_address: {
        street1: env.originAddress,
        city:    env.originCity,
        state:   env.originState,
        zip:     env.originZip,
        country: 'US',
      },
      to_address: {
        street1: dest.address1 ?? '',
        city:    dest.city ?? '',
        state:   dest.provinceCode ?? '',
        zip:     dest.postalCode ?? '',
        country: dest.countryCode,
      },
      parcel: { weight: weightOz },
      carrier_accounts: [{ id: accountId }],
      options: { currency: 'USD' },
    },
  };

  const resp = await fetch('https://api.easypost.com/v2/shipments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.easypostApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    console.warn(`[easypost] Shipment create failed for ${serviceCode}: ${resp.status}`);
    return null;
  }

  const data = await resp.json() as any;
  const rates: any[] = data?.rates ?? [];
  const match = rates.find(
    (r: any) =>
      r.carrier === info.carrier &&
      r.service === info.service &&
      r.carrier_account_id === accountId,
  );
  if (!match) {
    console.warn(`[easypost] No matching rate for ${serviceCode} (${info.carrier} ${info.service})`);
    return null;
  }
  return parseFloat(match.rate);
}

export class EasyPostAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    if (!env.easypostApiKey) {
      console.warn('[easypost] No EASYPOST_API_KEY — skipping');
      return [];
    }

    const settings = getSettings().carriers;
    const quotes: RateQuote[] = [];

    for (const [, cfg] of Object.entries(settings) as [string, any][]) {
      if (!cfg.enabled) continue;
      for (const svc of (cfg.services ?? [])) {
        if (!svc.enabled) continue;
        if (svc.domesticOnly && !shipment.isDomestic) continue;
        if (svc.internationalOnly && !shipment.isInternational && !shipment.isCanada) continue;
        if (svc.canadaOnly && !shipment.isCanada) continue;
        if (svc.maxWeightLb != null && shipment.totalShipmentWeightLb > svc.maxWeightLb) continue;
        if (svc.minWeightLb != null && shipment.totalShipmentWeightLb < svc.minWeightLb) continue;
        if (shipment.isHiAkTerritory && ['GROUND_SAVER_LIGHT', 'GROUND_SAVER_HEAVY'].includes(svc.code)) continue;

        try {
          const rate = await getEasyPostRate(svc.code, shipment);
          if (rate == null) continue;
          const total = rate + (svc.handlingFeeUsd ?? 0);
          quotes.push({
            carrier: internalCarrierKey(svc.code),
            serviceCode: svc.code,
            serviceName: svc.label,
            amountUsd: Number(total.toFixed(2)),
            currency: 'USD',
            debug: [
              `weightLb=${shipment.totalShipmentWeightLb.toFixed(3)}`,
              `service=${svc.code}`,
              'rateSource=easypost',
            ],
          });
        } catch (err) {
          console.error(`[easypost] Rate error for ${svc.code}:`, err);
        }
      }
    }

    return quotes;
  }
}
