import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';
import { env } from '../lib/env';
// estDeliveryDays support added
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

// Maps our internal service codes to the EasyPost service code returned in rate responses.
// This is used ONLY for matching — we make one API call per carrier account and
// match the returned rates against these codes.
const EP_SERVICE_CODE: Record<string, Record<string, string>> = {
  fedex: {
    FEDEX_GROUND: 'FEDEX_GROUND',
    GROUND_HOME_DELIVERY: 'GROUND_HOME_DELIVERY',
    FEDEX_2_DAY: 'FEDEX_2_DAY',
    PRIORITY_OVERNIGHT: 'PRIORITY_OVERNIGHT',
    STANDARD_OVERNIGHT: 'STANDARD_OVERNIGHT',
    INTERNATIONAL_GROUND_CA: 'FEDEX_GROUND',
    INTERNATIONAL_PRIORITY: 'INTERNATIONAL_PRIORITY',
    INTERNATIONAL_ECONOMY: 'INTERNATIONAL_ECONOMY',
    INTERNATIONAL_CONNECT_PLUS: 'FEDEX_INTERNATIONAL_CONNECT_PLUS',
  },
  usps: {
    GROUND_ADVANTAGE: 'GroundAdvantage',
    PRIORITY_MAIL: 'Priority',
    PRIORITY_MAIL_EXPRESS: 'Express',
    INTERNATIONAL_MAIL: 'FirstClassPackageInternationalService',
  },
  ups: {
    UPS_GROUND: 'Ground',
    UPS_2ND_DAY_AIR: '2ndDayAir',
  },
  ups_f: {
    UPS_GROUND_SAVER_LIGHT: 'UPSGroundSaver',
    UPS_GROUND_SAVER_HEAVY: 'UPSGroundSaver',
  },
  ups_one_rate: {
    UPS_ONE_RATE_GROUND: 'Ground',
    UPS_ONE_RATE_2ND_DAY_AIR: '2ndDayAir',
    UPS_ONE_RATE_NEXT_DAY_AIR_SAVER: 'NextDayAirSaver',
    UPS_ONE_RATE_NEXT_DAY_AIR: 'NextDayAir',
  },
  dhl_ecomm: {
    DHLeCommerceParcelExpedited: 'DHLeCommerceParcelExpedited',
    DHLeCommerceParcelExpeditedMax: 'DHLeCommerceParcelExpeditedMax',
    DHLeCommerceParcelGround: 'DHLeCommerceParcelGround',
    DHLeCommerceParcelPlus: 'DHLeCommerceParcelPlusExpedited',
    DHLeCommerceBPMExpedited: 'DHLeCommerceBPMExpedited',
    DHLeCommerceBPMGround: 'DHLeCommerceBPMGround',
  },
  dhl_express: {
    DHLExpressExpressWorldwide: 'DHLExpressExpressWorldwide',
    DHLExpressExpressMidpointDelivery: 'DHLExpressExpressMidpointDelivery',
    DHLExpressExpressEasyNDX: 'DHLExpressExpressEasyNDX',
    DHLExpressWorldwideNDX: 'DHLExpressWorldwideNDX',
  },
  fedex_wallet: {
    FEDEX_GROUND: 'FEDEX_GROUND',
    GROUND_HOME_DELIVERY: 'GROUND_HOME_DELIVERY',
    FEDEX_2_DAY: 'FEDEX_2_DAY',
    PRIORITY_OVERNIGHT: 'PRIORITY_OVERNIGHT',
    INTERNATIONAL_PRIORITY: 'INTERNATIONAL_PRIORITY',
    INTERNATIONAL_ECONOMY: 'INTERNATIONAL_ECONOMY',
  },
  asendia: {
    AsendiaUSePAQ: 'AsendiaUSePAQ',
    AsendiaUSePAQPlus: 'AsendiaUSePAQPlus',
    AsendiaUSePAQTracked: 'AsendiaUSePAQTracked',
    AsendiaUSePAQStandard: 'AsendiaUSePAQStandard',
  },
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
  fromZip?: string,
  isResidential?: boolean,
): Promise<Map<string, { rate: number; estDeliveryDays: number | null }>> {
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
        ...(shipment.destination.city ? { city: shipment.destination.city } : {}),
        ...(shipment.destination.provinceCode ? { state: shipment.destination.provinceCode } : {}),
        zip: shipment.destination.postalCode,
        country: shipment.destination.countryCode,
        ...(isResidential ? { residential: true } : {}),
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

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('[EasyPost] non-ok', accountId, resp.status, errText.substring(0, 500));
    throw new Error('[EasyPost] ' + accountId + ' ' + resp.status + ': ' + errText.substring(0, 200));
  }
  const data = await resp.json();
  const rates: any[] = data.rates ?? [];

  // Return a map of service -> rate so we can look up by service code quickly
  const rateMap = new Map<string, { rate: number; estDeliveryDays: number | null }>();
  for (const r of rates) {
          rateMap.set(r.service as string, { rate: parseFloat(r.rate), estDeliveryDays: r.est_delivery_days ?? null });
  }
  console.log('[EasyPost] rateMap for', accountId, JSON.stringify(Array.from(rateMap.keys())));
  return rateMap;
}

export class EasyPostAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment, fromZip?: string, isResidential?: boolean): Promise<RateQuote[]> {
    const settings = getSettings();
    const quotes: RateQuote[] = [];

    // Determine which carrier keys are enabled
    const enabledCarrierKeys = Object.entries(settings.carriers)
      .filter(([key, cfg]) => cfg.enabled && key in CARRIER_ACCOUNTS)
      .map(([key]) => key);

    // Fetch all rates in parallel — ONE API call per carrier account
        const ratesByCarrierKey = new Map<string, Map<string, { rate: number; estDeliveryDays: number | null }>>();
    const carrierResults = await Promise.allSettled(
      enabledCarrierKeys.map(async (carrierKey) => {
        const accountId = CARRIER_ACCOUNTS[carrierKey];
        const rateMap = await fetchAllRatesForAccount(accountId, shipment, fromZip, isResidential);
        ratesByCarrierKey.set(carrierKey, rateMap);
      }),
    );
    carrierResults.forEach((r, i) => {
      if (r.status === 'rejected') {
        console.error('[EasyPost] carrier failed', enabledCarrierKeys[i], r.reason);
      }
    });

    // Match our service definitions to the fetched rates
    for (const [carrierKey, carrierSettings] of Object.entries(settings.carriers)) {
      if (!carrierSettings.enabled) continue;
      if (!(carrierKey in CARRIER_ACCOUNTS)) continue;
      const rateMap = ratesByCarrierKey.get(carrierKey) ?? new Map<string, { rate: number; estDeliveryDays: number | null }>();
      const svcCodeMap = EP_SERVICE_CODE[carrierKey] ?? {};

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

        // Translate our service code to EasyPost's service code and look up the rate
        const epServiceCode = svcCodeMap[svc.code];
        if (!epServiceCode) continue;

              const epRate = rateMap.get(epServiceCode);
              if (epRate == null) continue;
              const rawRate = epRate.rate;
              const estDeliveryDays = epRate.estDeliveryDays;

        let finalAmount = rawRate;
        if (svc.handlingFeeUsd) finalAmount += svc.handlingFeeUsd;
        if (svc.flatRateUsd != null) finalAmount = svc.flatRateUsd;
        if (svc.freeThresholdUsd != null && shipment.totalShipmentWeightLb === 0) finalAmount = 0;

        quotes.push({
          carrier: internalCarrierKey(carrierKey),
          serviceCode: svc.code,
          serviceName: svc.label,
          amountUsd: finalAmount,
          currency: 'USD',
                    estDeliveryDays,
          debug: `rateSource=easypost carrier=${carrierKey} acct=${CARRIER_ACCOUNTS[carrierKey]} epSvc=${epServiceCode}`,
        });
      }
    }

    return quotes;
  }
}
