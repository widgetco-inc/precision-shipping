import { Router } from 'express';
import { requireApprovedAdmin } from './auth';
import {
    runWeightSync,
    setVariantTrueWeight,
    getLastSyncResult,
    isSyncInProgress,
} from '../services/weightSync';

const router = Router();

// ── GET /api/weights/sync-status ────────────────────────────────────────────
// Returns the most recent sync result (warnings + full records) without
// re-running the scan.  Used on initial page load.
router.get('/api/weights/sync-status', requireApprovedAdmin, (_req, res) => {
    res.json({
          inProgress: isSyncInProgress(),
          result: getLastSyncResult(),
    });
});

// ── POST /api/weights/sync ───────────────────────────────────────────────────
// Triggers a fresh scan of every Shopify product variant.
// Responds immediately with { started: true }; poll sync-status for results.
router.post('/api/weights/sync', requireApprovedAdmin, (_req, res) => {
    if (isSyncInProgress()) {
          res.status(409).json({ error: 'Sync already in progress' });
          return;
    }
    // Fire-and-forget; results stored in memory via weightSync module
              runWeightSync().catch((err) =>
                    console.error('[weights route] sync error:', err)
                                      );
    res.json({ started: true });
});

// ── PATCH /api/weights/:variantId ────────────────────────────────────────────
// Updates the true-weight metafield for a single variant.
// Body: { grams: number }
router.patch('/api/weights/:variantId', requireApprovedAdmin, async (req, res) => {
    const { variantId } = req.params;
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
