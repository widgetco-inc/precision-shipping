"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REST_OF_WORLD_RULES = exports.AK_HI_TERRITORY_RULES = exports.CANADA_RULES = exports.US_48_RULES = void 0;
exports.US_48_RULES = {
    suppressCarriers: ['USPS'],
    flatTiers: [
        { label: 'Standard Delivery', price: 4.95, maxSubtotal: 34.99 },
        { label: 'Standard Delivery', price: 0, minSubtotal: 35, maxSubtotal: 99.99 },
    ],
    calcTiers: [
        {
            carriers: ['FedEx Ground', 'UPS Ground'],
            cheapestOnly: true,
            overridePrice: 0,
            minSubtotal: 100,
        },
    ],
};
exports.CANADA_RULES = {
    passThrough: true,
    suppressUspsOverSubtotal: 100,
};
exports.AK_HI_TERRITORY_RULES = {
    passThrough: true,
    suppressUspsOverSubtotal: 100,
};
exports.REST_OF_WORLD_RULES = {
    suppressCarriers: ['USPS'],
    insureUsps: true,
    passThrough: true,
};
