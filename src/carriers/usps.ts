import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';

const basePrices: Record<string, number> = {
  GROUND_ADVANTAGE: 6,
  PRIORITY_MAIL: 9,
  INTERNATIONAL_MAIL: 28
};

export class UspsAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    const settings = getSettings().carriers.usps;
    if (!settings.enabled) return [];

    return settings.services
      .filter((service) => service.enabled)
      .filter((service) => {
        if (service.domesticOnly && !shipment.isDomestic) return false;
        if (service.internationalOnly && !shipment.isInternational) return false;
        if (service.maxWeightLb && shipment.totalShipmentWeightLb > service.maxWeightLb) return false;
        return true;
      })
      .map((service) => {
        const amountUsd = (basePrices[service.code] ?? 12) + Math.max(1, Math.ceil(shipment.totalShipmentWeightLb * 0.7)) + (service.handlingFeeUsd ?? 0);
        return {
          carrier: 'usps',
          serviceCode: service.code,
          serviceName: service.label,
          amountUsd: Number(amountUsd.toFixed(2)),
          currency: 'USD',
          debug: [`shipmentWeightLb=${shipment.totalShipmentWeightLb.toFixed(2)}`, `service=${service.code}`, 'rateSource=demo-usps-adapter']
        } satisfies RateQuote;
      });
  }
}
