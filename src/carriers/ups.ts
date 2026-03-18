import { CarrierAdapter } from './base';
import { RateQuote, Shipment } from '../types';
import { getSettings } from '../services/settingsStore';

const basePrices: Record<string, number> = {
  GROUND: 10,
  SECOND_DAY_AIR: 24,
  GROUND_SAVER: 8
};

export class UpsAdapter implements CarrierAdapter {
  async getRates(shipment: Shipment): Promise<RateQuote[]> {
    const settings = getSettings().carriers.ups;
    if (!settings.enabled || !shipment.isDomestic) return [];

    return settings.services
      .filter((service) => service.enabled)
      .filter((service) => !service.maxWeightLb || shipment.totalShipmentWeightLb <= service.maxWeightLb)
      .map((service) => {
        const amountUsd = (basePrices[service.code] ?? 15) + Math.max(1, Math.ceil(shipment.totalShipmentWeightLb)) * 1.15 + (service.handlingFeeUsd ?? 0);
        return {
          carrier: 'ups',
          serviceCode: service.code,
          serviceName: service.label,
          amountUsd: Number(amountUsd.toFixed(2)),
          currency: 'USD',
          debug: [`shipmentWeightLb=${shipment.totalShipmentWeightLb.toFixed(2)}`, `service=${service.code}`, 'rateSource=demo-ups-adapter']
        } satisfies RateQuote;
      });
  }
}
