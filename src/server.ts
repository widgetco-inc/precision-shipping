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
import weightsRoutes from './routes/weights';

const app = express();
app.use((_req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); }); // noindex
const START_TIME = Date.now();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Security headers — keep CSP off so EJS views load inline scripts
app.use(helmet({ contentSecurityPolicy: false }));

// CORS: only allow requests from the WidgetCo apps origin.
// This prevents any other app on apps.widgetco.com from accidentally
// calling our carrier-rate endpoints and sharing runtime state.
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin (no Origin header) and the known dashboard host
    const allowed = [
      'https://apps.widgetco.com',
      'https://widgetco.com',
    ];
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
// Allow plain-text / CSV bodies (used by POST /api/weights/csv)
app.use(express.text({ type: ['text/plain', 'text/csv'], limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware
app.use(session({
  secret: env.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));

// Health check — exposes uptime and version for monitoring / alerting.
// Hit GET /health to confirm the process is alive before routing real traffic.
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'widgetco-shipping-app',
    uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
    node: process.version,
  });
});

// Login / logout / robots.txt (public)
app.use(loginRoutes);

// Protected routes
app.use(appRoutes);
app.use(previewRoutes);
app.use(carrierRoutes);
app.use(adminRoutes);
app.use(weightsRoutes);

app.get('/', (_req, res) => res.redirect('/app'));

// ── Isolation safety net ─────────────────────────────────────────────────────
// Log unhandled promise rejections instead of silently swallowing them.
// This keeps the process alive while still surfacing the error so it can be
// investigated without an unexpected crash dropping live checkout traffic.
process.on('unhandledRejection', (reason) => {
  console.error('[shipping-app] Unhandled rejection:', reason);
});

// Same for unexpected thrown errors — log and stay up.
process.on('uncaughtException', (err) => {
  console.error('[shipping-app] Uncaught exception:', err);
});
// ─────────────────────────────────────────────────────────────────────────────

app.listen(env.port, () => {
  console.log(`WidgetCo shipping app listening on port ${env.port}`);
});
