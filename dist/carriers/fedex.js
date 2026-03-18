"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FedexAdapter = void 0;
const settingsStore_1 = require("../services/settingsStore");
const basePrices = {
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
class FedexAdapter {
    async getRates(shipment) {
        const settings = (0, settingsStore_1.getSettings)().carriers.fedex;
        if (!settings.enabled)
            return [];
        return settings.services
            .filter((service) => service.enabled)
            .filter((service) => {
            if (service.domesticOnly && !shipment.isDomestic)
                return false;
            if (service.internationalOnly && !shipment.isInternational)
                return false;
            if (service.canadaOnly && !shipment.isCanada)
                return false;
            if (typeof service.maxWeightLb === 'number' && shipment.totalShipmentWeightLb > service.maxWeightLb)
                return false;
            if (typeof service.minWeightLb === 'number' && shipment.totalShipmentWeightLb < service.minWeightLb)
                return false;
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
            };
        });
    }
}
exports.FedexAdapter = FedexAdapter;
