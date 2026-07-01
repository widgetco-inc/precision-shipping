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
      loadUploadedWeightsAsync,
      deleteUploadedWeightAsync,
} from '../services/weightSync';
import { getSettings, saveSettings } from '../services/settingsStore';
import { defaultSettings } from '../config/defaultSettings';

const router = Router();

scheduleNightlyAlert();

router.get('/api/weights/sync-status', requireApprovedAdmin, (_req, res) => {
      res.json({ inProgress: isSyncInProgress(), result: getLastSyncResult() });
});

router.get('/api/weights/uploaded', requireApprovedAdmin, async (_req, res) => {
      const weights = await loadUploadedWeightsAsync();
      res.json(weights);
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

router.delete('/api/weights/uploaded/:sku', requireApprovedAdmin, async (req, res) => {
      const sku = decodeURIComponent(String(req.params.sku || ''));
      if (!sku) { res.status(400).json({ error: 'sku param required' }); return; }
      const removed = await deleteUploadedWeightAsync(sku);
      if (!removed) { res.status(404).json({ error: 'SKU not found' }); return; }
      res.json({ ok: true, sku });
});

/**
 * PATCH /api/weights/sku/:sku/individual-box
 * Body: { individualBox: boolean }
 *
 * Adds or removes an exact-SKU shipsIndividually entry in skuBoxOverrides.
 * Prefix-based rules (e.g. "6-U", "6-ROLL") defined in defaultSettings.ts
 * are never modified — only per-SKU entries added via the UI are touched.
 */
router.patch('/api/weights/sku/:sku/individual-box', requireApprovedAdmin, (req, res) => {
      const sku = decodeURIComponent(String(req.params.sku || '')).toUpperCase();
      if (!sku) { res.status(400).json({ error: 'sku param required' }); return; }

               const enabled = req.body?.individualBox;
      if (typeof enabled !== 'boolean') {
              res.status(400).json({ error: 'body must be { individualBox: boolean }' });
              return;
      }

               const settings = getSettings();
      const overrides = settings.packaging.skuBoxOverrides ?? [];

               // Only touch exact-SKU entries — never modify prefix-based defaults
               const defaultPrefixes = new Set(
                       (defaultSettings.packaging.skuBoxOverrides ?? [])
                         .filter(o => o.shipsIndividually)
                         .map(o => o.skuPrefix.toUpperCase())
                     );

               // Remove any existing exact entry for this SKU
               const filtered = overrides.filter(o => {
                       const isExactMatch = o.skuPrefix.toUpperCase() === sku;
                       const isDefaultPrefix = defaultPrefixes.has(o.skuPrefix.toUpperCase());
                       return !isExactMatch || isDefaultPrefix;
               });

               if (enabled) {
                       filtered.push({ skuPrefix: sku, shipsIndividually: true });
               }

               settings.packaging.skuBoxOverrides = filtered;
      saveSettings(settings);

               console.log('[weights route] individual-box set sku=' + sku + ' enabled=' + enabled);
      res.json({ ok: true, sku, individualBox: enabled });
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
