"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UspsAdapter = void 0;
const settingsStore_1 = require("../services/settingsStore");
const basePrices = {
    GROUND_ADVANTAGE: 6,
    PRIORITY_MAIL: 9,
    INTERNATIONAL_MAIL: 28
};
class UspsAdapter {
    async getRates(shipment) {
        const settings = (0, settingsStore_1.getSettings)().carriers.usps;
        if (!settings.enabled)
            return [];
        return settings.services
            .filter((service) => service.enabled)
            .filter((service) => {
            if (service.domesticOnly && !shipment.isDomestic)
                return false;
            if (service.internationalOnly && !shipment.isInternational)
                return false;
            if (service.maxWeightLb && shipment.totalShipmentWeightLb > service.maxWeightLb)
                return false;
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
            };
        });
    }
}
exports.UspsAdapter = UspsAdapter;
