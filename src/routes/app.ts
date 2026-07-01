import { Router } from 'express';
import { requireApprovedAdmin } from './auth';
import { getSettings, saveSettings } from '../services/settingsStore';
import { env } from '../lib/env';
import { z } from 'zod';
import {
  US_48_RULES,
  CANADA_RULES,
  AK_HI_TERRITORY_RULES,
  REST_OF_WORLD_RULES,
} from '../config/shippingRules';

const router = Router();

// Build the zone rules summary passed to the app template
const ZONE_RULES_SUMMARY = [
  { zone: 'US 48 Contiguous States', rules: US_48_RULES },
  { zone: 'Canada', rules: CANADA_RULES },
  { zone: 'AK / HI / Territories', rules: AK_HI_TERRITORY_RULES },
  { zone: 'Rest of World', rules: REST_OF_WORLD_RULES },
];

router.get('/app', requireApprovedAdmin, (_req, res) => {
  res.render('app', {
    settings: getSettings(),
    admin: res.locals.admin,
    fedexAccountNumber: env.fedexAccountNumber,
    upsAccountNumber: env.upsAccountNumber,
    upsFAccountNumber: env.upsFAccountNumber,
    uspsAccountNumber: env.uspsAccountNumber,
    zoneRules: ZONE_RULES_SUMMARY,
  });
});

router.get('/api/settings', requireApprovedAdmin, (_req, res) => {
  res.json(getSettings());
});

const settingsSchema = z.object({
  carriers: z.any(),
  packaging: z.any(),
  access: z.any(),
  closureDates: z.array(z.object({ date: z.string(), label: z.string() })).optional(),
});

router.post('/api/settings', requireApprovedAdmin, (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(saveSettings(parsed.data as any));
});

// ── Closure-date toggle endpoint ──────────────────────────────────────────────
// PATCH /api/settings/closure-dates
// Body: { date: 'YYYY-MM-DD', label: string, closed: boolean }
// Adds or removes a single date from settings.closureDates and persists to DB.
router.patch('/api/settings/closure-dates', requireApprovedAdmin, (req, res) => {
  const { date, label, closed } = req.body as { date: string; label: string; closed: boolean };
  if (!date || typeof closed !== 'boolean') {
    res.status(400).json({ error: 'date and closed are required' });
    return;
  }
  const settings = getSettings();
  const dates = (settings.closureDates ?? []).filter(d => d.date !== date);
  if (closed) dates.push({ date, label: label || date });
  // Keep sorted
  dates.sort((a, b) => a.date.localeCompare(b.date));
  settings.closureDates = dates;
  saveSettings(settings);
  res.json({ closureDates: settings.closureDates });
});

export default router;
