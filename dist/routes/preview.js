"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const ratingEngine_1 = require("../services/ratingEngine");
const fedex_1 = require("../carriers/fedex");
const ups_1 = require("../carriers/ups");
const usps_1 = require("../carriers/usps");
const auth_1 = require("./auth");
const router = (0, express_1.Router)();
const previewSchema = zod_1.z.object({
    destination: zod_1.z.object({
        countryCode: zod_1.z.string().min(2),
        provinceCode: zod_1.z.string().optional(),
        postalCode: zod_1.z.string().optional(),
        city: zod_1.z.string().optional()
    }),
    lines: zod_1.z.array(zod_1.z.object({
        variantId: zod_1.z.string().optional(),
        sku: zod_1.z.string().optional(),
        title: zod_1.z.string().optional(),
        quantity: zod_1.z.number().int().positive(),
        trueWeightGrams: zod_1.z.number().positive().optional()
    })).min(1)
});
router.post('/api/preview', auth_1.requireApprovedAdmin, async (req, res) => {
    const parsed = previewSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    const shipment = (0, ratingEngine_1.buildShipment)(parsed.data.lines, parsed.data.destination);
    const adapters = [new fedex_1.FedexAdapter(), new ups_1.UpsAdapter(), new usps_1.UspsAdapter()];
    const results = await Promise.all(adapters.map((adapter) => adapter.getRates(shipment)));
    const rates = results.flat().sort((a, b) => a.amountUsd - b.amountUsd);
    res.json({ shipment, rates });
});
exports.default = router;
