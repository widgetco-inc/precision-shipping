import { Router } from 'express';
import { registerCarrierService } from '../shopify';
import { requireApprovedAdmin } from './auth';

const router = Router();

router.post('/admin/register-carrier-service', requireApprovedAdmin, async (_req, res) => {
  try {
    const result = await registerCarrierService();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export default router;
