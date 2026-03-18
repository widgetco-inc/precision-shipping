import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';

const basePrices: Record<string, number> = {
  FEDEX_GROUND: 11,
  GROUND_HOME_DELIVERY: 12,
  FEDEX_2_DAY: 28,
  PRIORITY_OVERNIGHT: 48,
  STANDARD_OVERNIGHT: 42,
  INTERNATIONAL_GROUND_CA: 24,
  INTERNATIONAL_PRIORITY: 68,
  INTERNATIONAL_ECONOMY: 55,
  INTERNATIONAL_CONNECT_PLUS: 38
};

export class FedexAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    const settings = getSettings().carriers.fedex;
    if (!settings.enabled) return [];

    return settings.services
      .filter((service) => service.enabled)
      .filter((service) => {
        if (service.domesticOnly && !shipment.isDomestic) return false;
        if (service.internationalOnly && !shipment.isInternational) return false;
        if (service.canadaOnly && !shipment.isCanada) return false;
        if (typeof service.maxWeightLb === 'number' && shipment.totalShipmentWeightLb > service.maxWeightLb) return false;
        if (typeof service.minWeightLb === 'number' && shipment.totalShipmentWeightLb < service.minWeightLb) return false;
        return true;
      })
      .map((service) => {
        const weightFactor = Math.max(1, Math.ceil(shipment.totalShipmentWeightLb));
        const amountUsd = (basePrices[service.code] ?? 20) + weightFactor * (shipment.isInternational ? 3.2 : 1.35) + (service.handlingFeeUsd ?? 0);
        const debug = [
          `shipmentWeightLb=${shipment.totalShipmentWeightLb.toFixed(2)}`,
          `service=${service.code}`,
          'rateSource=demo-fedex-adapter',
          shipment.eligibleForFedexEnvelope && ['FEDEX_2_DAY', 'PRIORITY_OVERNIGHT', 'STANDARD_OVERNIGHT'].includes(service.code)
            ? 'envelopeEligible=true'
            : 'envelopeEligible=false'
        ];

        return {
          carrier: 'fedex',
          serviceCode: service.code,
          serviceName: service.label,
          amountUsd: Number(amountUsd.toFixed(2)),
          currency: 'USD',
          debug
        } satisfies RateQuote;
      });
  }
}
