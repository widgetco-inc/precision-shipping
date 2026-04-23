import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';
import { env } from '../lib/env';

// EasyPost carrier account IDs mapped to our carrier setting keys
const CARRIER_ACCOUNTS: Record<string, string> = {
  // Personal carrier accounts
  fedex: 'ca_544bae948c20483c947448953a736823',
  ups: 'ca_5065a768022845f89a3e646a6eafa19b',
  ups_f: 'ca_61b89a3dcdaa4c8b8acd96e595c2de91',
  ups_one_rate: 'ca_024451c3996d417fa0ecf521bbd30f82',
  usps: 'ca_2046b502461e4ad68b6cf6c0f0f9843b',
  // EasyPost Wallet carriers
  dhl_ecomm: 'ca_0835e9c34bac49d1a0a419bfc3a6074b',
  dhl_express: 'ca_74860ca138bf4590a299e3a9d2dd2159',
  fedex_wallet: 'ca_36962392a6704d2389b0d2a96f843585',
  asendia: 'ca_d998402343be4f8abcdaf281e678b9d2',
};

// Maps our carrier key to the internal CarrierCode string used in RateQuote
function internalCarrierKey(carrierKey: string): RateQuote['carrier'] {
  if (carrierKey === 'fedex' || carrierKey === 'fedex_wallet') return 'fedex';
  if (carrierKey === 'ups' || carrierKey === 'ups_f' || carrierKey === 'ups_one_rate') return 'ups';
  if (carrierKey === 'dhl_ecomm' || carrierKey === 'dhl_express') return 'dhl_ecomm' as RateQuote['carrier'];
  if (carrierKey === 'asendia') return 'asendia' as RateQuote['carrier'];
  return carrierKey as RateQuote['carrier'];
}

// Fetch ALL rates for a given carrier account from EasyPost in a single API call
async function fetchAllRatesForAccount(
  accountId: string,
  shipment: Shipment,
): Promise<Array<{ carrier: string; service: string; rate: number }>> {
  const body = {
    shipment: {
      from_address: {
        street1: '1550 S State College Blvd',
        city: 'Anaheim',
        state: 'CA',
        zip: '92806',
        country: 'US',
      },
      to_address: {
        street1: shipment.destination.address1 ?? '123 Main St',
        city: shipment.destination.city ?? '',
        state: shipment.destination.provinceCode ?? '',
        zip: shipment.destination.postalCode,
        country: shipment.destination.countryCode,
      },
      parcel: {
        weight: shipment.totalShipmentWeightLb * 16, // oz
        length: 12,
        width: 9,
        height: 4,
      },
      carrier_accounts: [accountId],
    },
  };

  const resp = await fetch('https://api.easypost.com/v2/shipments', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(env.easypostApiKey + ':').toString('base64'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return [];
  const data = await resp.json();
  const rates: any[] = data.rates ?? [];
  return rates.map((r: any) => ({
    carrier: r.carrier as string,
    service: r.service as string,
    rate: parseFloat(r.rate),
  }));
}

export class EasyPostAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    const settings = getSettings();
    const quotes: RateQuote[] = [];

    // Group enabled carrier keys by their EasyPost account ID so we make
    // exactly ONE API call per account, then match all returned rates back
    // to our service definitions.
    const enabledCarrierKeys = Object.entries(settings.carriers)
      .filter(([key, cfg]) => cfg.enabled && key in CARRIER_ACCOUNTS)
      .map(([key]) => key);

    // Fetch rates for all accounts in parallel
    const ratesByCarrierKey = new Map<string, Array<{ carrier: string; service: string; rate: number }>>();
    await Promise.all(
      enabledCarrierKeys.map(async (carrierKey) => {
        const accountId = CARRIER_ACCOUNTS[carrierKey];
        const rates = await fetchAllRatesForAccount(accountId, shipment);
        ratesByCarrierKey.set(carrierKey, rates);
      }),
    );

    // Now iterate our service definitions and match against the fetched rates
    for (const [carrierKey, carrierSettings] of Object.entries(settings.carriers)) {
      if (!carrierSettings.enabled) continue;
      if (!(carrierKey in CARRIER_ACCOUNTS)) continue;

      const epRates = ratesByCarrierKey.get(carrierKey) ?? [];

      for (const svc of carrierSettings.services) {
        if (!svc.enabled) continue;

        // Apply eligibility filters
        if (svc.domesticOnly && !shipment.isDomestic) continue;
        if (svc.internationalOnly && !shipment.isInternational) continue;
        if (svc.canadaOnly && !shipment.isCanada) continue;
        if (svc.hiAkOnly && !shipment.isHiAkTerritory) continue;
        if (svc.excludeHiAk && shipment.isHiAkTerritory) continue;
        if (svc.maxWeightLb != null && shipment.totalShipmentWeightLb > svc.maxWeightLb) continue;
        if (svc.minWeightLb != null && shipment.totalShipmentWeightLb < svc.minWeightLb) continue;

        // Find a matching rate from EasyPost's response.
        // We match by service code (case-insensitive) since EasyPost returns
        // the service code directly (e.g. "FEDEX_GROUND", "Ground", "Priority").
        const match = epRates.find(
          (r) => r.service.toLowerCase() === svc.code.toLowerCase(),
        );

        if (match == null) continue;

        let finalAmount = match.rate;
        if (svc.handlingFeeUsd) finalAmount += svc.handlingFeeUsd;
        if (svc.flatRateUsd != null) finalAmount = svc.flatRateUsd;
        if (svc.freeThresholdUsd != null && shipment.totalShipmentWeightLb === 0) finalAmount = 0;

        quotes.push({
          carrier: internalCarrierKey(carrierKey),
          serviceCode: svc.code,
          serviceName: svc.label,
          amountUsd: finalAmount,
          currency: 'USD',
          debug: `rateSource=easypost carrier=${carrierKey} acct=${CARRIER_ACCOUNTS[carrierKey]} epService=${match.service}`,
        });
      }
    }

    return quotes;
  }
}
