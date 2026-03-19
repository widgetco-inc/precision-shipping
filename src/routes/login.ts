import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { env } from '../lib/env';

const router = Router();

// Two authorised users only
const USERS = [
  { email: 'jg@widgetco.com',       hash: env.jonathanPasswordHash },
  { email: 'lgerkey@widgetco.com',  hash: env.lauraPasswordHash },
];

// GET /login
router.get('/login', (req, res) => {
  const session = (req as any).session;
  if (session?.userEmail) return res.redirect('/app');
  res.render('login', { error: null, prefill: '' });
});

// POST /login
router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email: string; password: string };
  const emailLower = (email || '').toLowerCase().trim();
  const user = USERS.find(u => u.email === emailLower);

  if (!user || !user.hash) {
    return res.render('login', { error: 'Invalid email or password.', prefill: email });
  }

  const valid = await bcrypt.compare(password, user.hash);
  if (!valid) {
    return res.render('login', { error: 'Invalid email or password.', prefill: email });
  }

  (req as any).session.userEmail = emailLower;
  res.redirect('/app');
});

// GET /logout
router.get('/logout', (req, res) => {
  (req as any).session.destroy(() => res.redirect('/login'));
});

// GET /robots.txt  — disallow all crawlers
router.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /\n');
});

export default router;
