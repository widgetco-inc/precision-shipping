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
} from '../services/weightSync';

const router = Router();

// ── Start nightly alert scheduler once when this module is loaded ─────────────
scheduleNightlyAlert();

// ── GET /api/weights/sync-status ─────────────────────────────────────────────
// Returns the most recent sync result (warnings + full records) without
// re-running the scan. Used on initial page load.
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

// ── POST /api/weights/csv ────────────────────────────────────────────────────
// Accepts a plain-text CSV body (Content-Type: text/plain or text/csv).
// Expected format: sku,grams  (header row optional).
// Returns CsvImportResult: { attempted, succeeded, skipped, errors }.
router.post('/api/weights/csv', requireApprovedAdmin, async (req, res) => {
  let csvText: string;

  // Support both raw text body and JSON wrapper { csv: "..." }
  if (typeof req.body === 'string') {
    csvText = req.body;
  } else if (req.body?.csv && typeof req.body.csv === 'string') {
    csvText = req.body.csv;
  } else {
    res.status(400).json({ error: 'Send CSV as plain text body or JSON { csv: "..." }' });
    return;
  }

  try {
    const result = await bulkImportFromCsv(csvText);
    res.json(result);
  } catch (err: any) {
    console.error('[weights route] CSV import error:', err);
    res.status(502).json({ error: err?.message ?? 'CSV import failed' });
  }
});

// ── GET /api/weights/alerts ──────────────────────────────────────────────────
// Returns the most recent nightly alert result (warnings for missing /
// mismatched weights detected by the 02:00 scheduled job).
router.get('/api/weights/alerts', requireApprovedAdmin, (_req, res) => {
  res.json({ alert: getLastNightlyAlert() });
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
