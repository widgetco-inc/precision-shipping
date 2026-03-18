"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpsAdapter = void 0;
const settingsStore_1 = require("../services/settingsStore");
const basePrices = {
    GROUND: 10,
    SECOND_DAY_AIR: 24,
    GROUND_SAVER: 8
};
class UpsAdapter {
    async getRates(shipment) {
        const settings = (0, settingsStore_1.getSettings)().carriers.ups;
        if (!settings.enabled || !shipment.isDomestic)
            return [];
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
            };
        });
    }
}
exports.UpsAdapter = UpsAdapter;
