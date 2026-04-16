"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("./auth");
const weightSync_1 = require("../services/weightSync");
const router = (0, express_1.Router)();
// Start nightly alert scheduler once when this module is loaded
(0, weightSync_1.scheduleNightlyAlert)();
// GET /api/weights/sync-status
router.get('/api/weights/sync-status', auth_1.requireApprovedAdmin, (_req, res) => {
    res.json({
        inProgress: (0, weightSync_1.isSyncInProgress)(),
        result: (0, weightSync_1.getLastSyncResult)(),
    });
});
// POST /api/weights/sync
router.post('/api/weights/sync', auth_1.requireApprovedAdmin, (_req, res) => {
    if ((0, weightSync_1.isSyncInProgress)()) {
        res.status(409).json({ error: 'Sync already in progress' });
        return;
    }
    (0, weightSync_1.runWeightSync)().catch((err) => console.error('[weights route] sync error:', err));
    res.json({ started: true });
});
// POST /api/weights/csv
router.post('/api/weights/csv', auth_1.requireApprovedAdmin, async (req, res) => {
    let csvText;
    if (typeof req.body === 'string') {
        csvText = req.body;
    } else if (req.body?.csv && typeof req.body.csv === 'string') {
        csvText = req.body.csv;
    } else {
        res.status(400).json({ error: 'Send CSV as plain text body or JSON { csv: "..." }' });
        return;
    }
    try {
        const result = await (0, weightSync_1.bulkImportFromCsv)(csvText);
        res.json(result);
    } catch (err) {
        console.error('[weights route] CSV import error:', err);
        res.status(502).json({ error: err?.message ?? 'CSV import failed' });
    }
});
// GET /api/weights/alerts
router.get('/api/weights/alerts', auth_1.requireApprovedAdmin, (_req, res) => {
    res.json({ alert: (0, weightSync_1.getLastNightlyAlert)() });
});
// PATCH /api/weights/:variantId
router.patch('/api/weights/:variantId', auth_1.requireApprovedAdmin, async (req, res) => {
    const { variantId } = req.params;
    const grams = Number(req.body?.grams);
    if (!variantId || isNaN(grams) || grams < 0) {
        res.status(400).json({ error: 'variantId param and numeric grams body required' });
        return;
    }
    try {
        await (0, weightSync_1.setVariantTrueWeight)(variantId, grams);
        res.json({ ok: true, variantId, grams });
    } catch (err) {
        console.error('[weights route] patch error:', err);
        res.status(502).json({ error: err?.message ?? 'Shopify metafield update failed' });
    }
});
exports.default = router;
