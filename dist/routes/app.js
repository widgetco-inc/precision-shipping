"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("./auth");
const settingsStore_1 = require("../services/settingsStore");
const env_1 = require("../lib/env");
const zod_1 = require("zod");
const shippingRules_1 = require("../config/shippingRules");
const router = (0, express_1.Router)();
const ZONE_RULES_SUMMARY = [
    { zone: 'US 48 Contiguous States', rules: shippingRules_1.US_48_RULES },
    { zone: 'Canada',                  rules: shippingRules_1.CANADA_RULES },
    { zone: 'AK / HI / Territories',  rules: shippingRules_1.AK_HI_TERRITORY_RULES },
    { zone: 'Rest of World',           rules: shippingRules_1.REST_OF_WORLD_RULES },
];
router.get('/app', auth_1.requireApprovedAdmin, (_req, res) => {
    res.render('app', {
        settings: (0, settingsStore_1.getSettings)(),
        admin: res.locals.admin,
        fedexAccountNumber: env_1.env.fedexAccountNumber,
        upsAccountNumber: env_1.env.upsAccountNumber,
        upsFAccountNumber: env_1.env.upsFAccountNumber,
        uspsAccountNumber: env_1.env.uspsAccountNumber,
        zoneRules: ZONE_RULES_SUMMARY,
    });
});
router.get('/api/settings', auth_1.requireApprovedAdmin, (_req, res) => {
    res.json((0, settingsStore_1.getSettings)());
});
const settingsSchema = zod_1.z.object({
    carriers: zod_1.z.any(),
    packaging: zod_1.z.any(),
    access: zod_1.z.any()
});
router.post('/api/settings', auth_1.requireApprovedAdmin, (req, res) => {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
    }
    res.json((0, settingsStore_1.saveSettings)(parsed.data));
});
exports.default = router;
