"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("./auth");
const settingsStore_1 = require("../services/settingsStore");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
router.get('/app', auth_1.requireApprovedAdmin, (_req, res) => {
    res.render('app', { settings: (0, settingsStore_1.getSettings)(), admin: res.locals.admin });
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
