import { Router } from 'express';
import { requireApprovedAdmin } from './auth';
import {
    runWeightSync,
    setVariantTrueWeight,
    getLastSyncResult,
    isSyncInProgress,
    bulkImportFromCsv,
    getLastNightlyAlert,
    scheduleNightlyAlert,
    loadUploadedWeights,
} from '../services/weightSync';

const router = Router();

scheduleNightlyAlert();

router.get('/api/weights/sync-status', requireApprovedAdmin, (_req, res) => {
    res.json({ inProgress: isSyncInProgress(), result: getLastSyncResult() });
});

router.get('/api/weights/uploaded', requireApprovedAdmin, (_req, res) => {
    res.json(loadUploadedWeights());
});

router.post('/api/weights/sync', requireApprovedAdmin, (_req, res) => {
    if (isSyncInProgress()) { res.status(409).json({ error: 'Sync already in progress' }); return; }
    runWeightSync().catch((err) => console.error('[weights route] sync error:', err));
    res.json({ started: true });
});

router.post('/api/weights/csv', requireApprovedAdmin, async (req, res) => {
    let csvText: string;
    if (typeof req.body === 'string') { csvText = req.body; }
    else if (req.body?.csv && typeof req.body.csv === 'string') { csvText = req.body.csv; }
    else { res.status(400).json({ error: 'Send CSV as plain text body' }); return; }
    try {
          const result = await bulkImportFromCsv(csvText);
          res.json(result);
    } catch (err: any) {
    console.error('[weights route] CSV import error:', err);
          res.status(502).json({ error: err?.message ?? 'CSV import failed' });
    }
});

router.get('/api/weights/alerts', requireApprovedAdmin, (_req, res) => {
    res.json({ alert: getLastNightlyAlert() });
});

router.patch('/api/weights/:variantId', requireApprovedAdmin, async (req, res) => {
    const variantId = String(req.params.variantId || '');
    const grams = Number(req.body?.grams);
    if (!variantId || isNaN(grams) || grams < 0) {
          res.status(400).json({ error: 'variantId param and numeric grams body required' });
          return;
    }
    try {
          await setVariantTrueWeight(variantId, grams);
          res.json({ ok: true, variantId, grams });
    } catch (err: any) {
    console.error('[weights route] patch error:', err);
          res.status(502).json({ error: err?.message ?? 'Shopify metafield update failed' });
    }
});

export default router;
