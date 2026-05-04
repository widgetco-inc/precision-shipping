import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import session from 'express-session';
import { env } from './lib/env';
import loginRoutes from './routes/login';
import appRoutes from './routes/app';
import previewRoutes from './routes/preview';
import carrierRoutes from './routes/carrier';
import adminRoutes from './routes/admin';
import { loadSettingsFromDb } from './services/settingsStore';
import weightsRoutes from './routes/weights';
import ordersRoutes from './routes/orders';

const app = express();

app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });

const START_TIME = Date.now();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));

app.use(cors({
  origin: (origin, cb) => {
    const allowed = [
      'https://apps.widgetco.com',
      'https://ship.widgetco.com',
      'https://widgetco.com',
    ];
    if (!origin || origin === 'null' || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.text({ type: ['text/plain', 'text/csv'], limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware — 24h to reduce admin re-login friction
app.use(session({
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 },
}));

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'widgetco-shipping-app',
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    node: process.version,
  });
});

/**
 * OAuth callback — Shopify redirects here after admin approves the app install.
 * Exchanges the one-time code for a permanent offline access token and
 * displays it so it can be saved into Railway SHOPIFY_ADMIN_ACCESS_TOKEN.
 */
app.get('/auth/callback', async (req, res) => {
  const { code, shop } = req.query as Record<string, string>;

  if (!code || !shop) {
    res.status(400).send('<h2>Missing code or shop parameter</h2>');
    return;
  }

  const clientId     = process.env.SHOPIFY_API_KEY;
  const clientSecret = process.env.SHOPIFY_API_SECRET;

  if (!clientId || !clientSecret) {
    res.status(500).send('<h2>SHOPIFY_API_KEY or SHOPIFY_API_SECRET not configured</h2>');
    return;
  }

  try {
    const tokenRes = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      }
    );
    const tokenData: any = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.access_token) {
      res.status(500).send(`<h2>Token exchange failed</h2><pre>${JSON.stringify(tokenData, null, 2)}</pre>`);
      return;
    }

    const token = tokenData.access_token;
    console.log('[auth/callback] Fresh access token obtained for shop:', shop);

    res.send(`<!DOCTYPE html>
<html>
<head><title>Token Ready — Precision Shipping</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 20px;color:#111}
  h2{color:#16a34a}
  .token{background:#f0fdf4;border:2px solid #16a34a;border-radius:8px;padding:16px 20px;word-break:break-all;font-family:monospace;font-size:13px;margin:16px 0;user-select:all}
  .steps{background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:16px 20px}
  ol{margin:4px 0;padding-left:22px;line-height:2.2}
  code{background:#e2e8f0;padding:1px 5px;border-radius:4px;font-size:12px}
  a{color:#2563eb}
</style>
</head>
<body>
  <h2>✅ Fresh Access Token Generated</h2>
  <p>Copy this token (click to select all), then save it in Railway:</p>
  <div class="token">${token}</div>
  <div class="steps">
    <strong>Next steps:</strong>
    <ol>
      <li>Copy the token above</li>
      <li>Go to <strong>Railway → precision-shipping → Variables</strong></li>
      <li>Click <strong>⋮</strong> next to <code>SHOPIFY_ADMIN_ACCESS_TOKEN</code> → <strong>Edit</strong></li>
      <li>Paste the new value and save — Railway will redeploy automatically</li>
      <li>Come back and <a href="/app">return to the app</a>, then trigger carrier registration</li>
    </ol>
  </div>
</body>
</html>`);
  } catch (err: any) {
    console.error('[auth/callback] Error exchanging token:', err);
    res.status(500).send(`<h2>Error</h2><pre>${err?.message}</pre>`);
  }
});

app.use(loginRoutes);
app.use(appRoutes);
app.use(previewRoutes);
app.use(carrierRoutes);
app.use(adminRoutes);
app.use(weightsRoutes);
app.use(ordersRoutes);

app.get('/', (_req, res) => res.redirect('/app'));

process.on('unhandledRejection', (reason) => {
  console.error('[shipping-app] Unhandled rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[shipping-app] Uncaught exception:', err);
});

loadSettingsFromDb().then(() => {
  app.listen(env.port, () => {
    console.log(`WidgetCo shipping app listening on port ${env.port}`);
  });
}).catch((err) => {
  console.error('[startup] Failed to load settings from DB:', err);
  app.listen(env.port, () => {
    console.log(`WidgetCo shipping app listening on port ${env.port} (DB load failed)`);
  });
});
