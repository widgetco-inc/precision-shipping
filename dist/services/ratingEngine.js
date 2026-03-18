"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildShipment = buildShipment;
const settingsStore_1 = require("./settingsStore");
const catalog_1 = require("./catalog");
const GRAMS_PER_LB = 453.59237;
function buildShipment(lines, destination) {
    const settings = (0, settingsStore_1.getSettings)();
    const shipmentLines = lines.map((line) => {
        const resolvedWeightGrams = (0, catalog_1.resolveTrueWeightGrams)(line.variantId, line.sku, line.trueWeightGrams);
        return { ...line, resolvedWeightGrams };
    });
    const totalItemWeightGrams = shipmentLines.reduce((sum, line) => sum + (line.resolvedWeightGrams * line.quantity), 0);
    const packageTareGrams = settings.packaging.defaultPackageTareLb * GRAMS_PER_LB;
    const totalShipmentWeightGrams = totalItemWeightGrams + packageTareGrams;
    const totalShipmentWeightLb = totalShipmentWeightGrams / GRAMS_PER_LB;
    const isCanada = destination.countryCode.toUpperCase() === 'CA';
    const isDomestic = ['US', 'USA'].includes(destination.countryCode.toUpperCase());
    const isInternational = !isDomestic;
    const eligibleForFedexEnvelope = settings.packaging.useFedexEnvelopeForExpress && totalShipmentWeightLb <= settings.packaging.expressEnvelopeMaxWeightLb;
    return {
        lines: shipmentLines,
        totalItemWeightGrams,
        packageTareGrams,
        totalShipmentWeightGrams,
        totalShipmentWeightLb,
        destination,
        isDomestic,
        isCanada,
        isInternational,
        eligibleForFedexEnvelope
    };
}
