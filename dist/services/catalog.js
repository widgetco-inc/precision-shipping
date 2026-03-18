"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveTrueWeightGrams = resolveTrueWeightGrams;
const demoCatalog = {
    'demo-0-1g': { sku: 'DEMO-0-1G', trueWeightGrams: 0.1 },
    'demo-0-4g': { sku: 'DEMO-0-4G', trueWeightGrams: 0.4 },
    'demo-2-0g': { sku: 'DEMO-2-0G', trueWeightGrams: 2.0 }
};
function resolveTrueWeightGrams(variantId, sku, directValue) {
    if (typeof directValue === 'number' && directValue > 0)
        return directValue;
    if (variantId && demoCatalog[variantId])
        return demoCatalog[variantId].trueWeightGrams;
    const bySku = Object.values(demoCatalog).find((r) => r.sku === sku);
    if (bySku)
        return bySku.trueWeightGrams;
    return 0.1;
}
