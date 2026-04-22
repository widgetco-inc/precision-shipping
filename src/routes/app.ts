import { Router } from 'express';
import { requireApprovedAdmin } from './auth';
import { getSettings, saveSettings } from '../services/settingsStore';
import { env } from '../lib/env';
import { z } from 'zod';

const router = Router();

router.get('/app', requireApprovedAdmin, (_req, res) => {
      res.render('app', { settings: getSettings(), admin: res.locals.admin, fedexAccountNumber: env.fedexAccountNumber, upsAccountNumber: env.upsAccountNumber, upsFAccountNumber: env.upsFAccountNumber, uspsAccountNumber: env.uspsAccountNumber });
});

router.get('/api/settings', requireApprovedAdmin, (_req, res) => {
  res.json(getSettings());
});

const settingsSchema = z.object({
  carriers: z.any(),
  packaging: z.any(),
  access: z.any()
});

router.post('/api/settings', requireApprovedAdmin, (req, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(saveSettings(parsed.data as any));
});

export default router;
