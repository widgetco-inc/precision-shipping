import { Router, Request, Response } from 'express';
import { env } from '../lib/env';

// ── Types ──────────────────────────────────────────────────────────────────

interface ShippingCopConfig {
  lossThreshold: number;
  ignore48StateFreeShipping: boolean;
  slackEnabled: boolean;
  lookbackHours: number;
}

// Extend express app.locals type
declare global {
  namespace Express {
    interface Locals {
      shippingCopConfig?: ShippingCopConfig;
    }
  }
}

// ── Defaults & constants ───────────────────────────────────────────────────

const SHIPPING_COP_DEFAULTS: ShippingCopConfig = {
  lossThreshold: 10.00,
  ignore48StateFreeShipping: true,
  slackEnabled: true,
  lookbackHours: 1
};

const STATES_48 = new Set([
  'AL','AZ','AR','CA','CO','CT','DE','FL','GA','ID','IL','IN','IA','KS',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA',
  'WV','WI','WY','DC'
]);

// ── Helper: match service label ────────────────────────────────────────────

function matchService(s: string): string {
  if (!s) return 'Other';
  const u = s.toUpperCase();
  if (u.includes('FEDEX')) return 'FedEx';
  if (u.includes('UPS')) return 'UPS';
  if (u.includes('USPS') || u.includes('FIRST CLASS') || u.includes('PRIORITY MAIL')) return 'USPS';
  if (u.includes('DHL')) return 'DHL';
  return 'Other';
}

// ── Helper: count delivery days excluding non-delivery days ───────────────

function countDays(shipDate: string, deliverDate: string, serviceLabel: string): number {
  const start = new Date(shipDate);
  const end = new Date(deliverDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  let count = 0;
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= end) {
    const day = cursor.getDay(); // 0=Sun, 6=Sat
    const isSat = day === 6;
    const isSun = day === 0;
    const svc = matchService(serviceLabel);
    // FedEx Ground / UPS Ground Saver: exclude Sat+Sun
    if (svc === 'FedEx' || svc === 'UPS') {
      if (!isSat && !isSun) count++;
    } else {
      // USPS, DHL, Other: exclude Sunday only
      if (!isSun) count++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

// ── Core: runShippingCop ───────────────────────────────────────────────────

async function runShippingCop(config: ShippingCopConfig): Promise<{
  flagged: unknown[];
  message: string;
  stats: Record<string, unknown>;
}> {
  const {
    lossThreshold,
    ignore48StateFreeShipping,
    slackEnabled,
    lookbackHours
  } = config;

  const SHIPSTATION_KEY = process.env.SHIPSTATION_API_KEY || '';
  const SHIPSTATION_SECRET = process.env.SHIPSTATION_API_SECRET || '';
  const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
  const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP || '';
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';
  const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_SHIPPING_COP || '';

  const ssAuth = Buffer.from(`${SHIPSTATION_KEY}:${SHIPSTATION_SECRET}`).toString('base64');
  const now = new Date();
  const fromDate = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  const toDateStr = now.toISOString().split('T')[0];
  const fromDateStr = fromDate.toISOString().split('T')[0];

  // Step 1: Get ShipStation V2 shipments for the date range
  const ssV2Resp = await fetch(
    `https://api.shipstation.com/v2/shipments?shipped_date_start=${fromDateStr}&shipped_date_end=${toDateStr}&page_size=500`,
    { headers: { 'Authorization': `Basic ${ssAuth}`, 'Content-Type': 'application/json' } }
  );
  const ssV2Data = await ssV2Resp.json() as { shipments?: unknown[] };

  // Step 2: Get ShipStation V1 shipments for the date range (for shipping cost)
  const ssUrl = `https://ssapi.shipstation.com/shipments?shipDateStart=${fromDateStr}&shipDateEnd=${toDateStr}&pageSize=500`;
  const ssResp = await fetch(ssUrl, { headers: { 'Authorization': 'Basic ' + ssAuth } });
  const ssData = await ssResp.json() as { shipments?: Array<{
    trackingNumber: string;
    shipmentCost: number;
    otherCost: number;
    serviceCode: string;
    shipDate: string;
    shipTo?: { state?: string };
    orderNumber?: string;
  }> };

  // Step 3: Filter by target services and build tracking map
  const shipments = ssData.shipments || [];
  const trackingMap = new Map<string, typeof shipments[0]>();
  for (const s of shipments) {
    if (s.trackingNumber) trackingMap.set(s.trackingNumber, s);
  }

  // Step 4: Get Shopify fulfillments with delivery info
  const shopifyShipments: Array<Record<string, unknown>> = [];
  let nextPageUrl: string | null =
    `https://${SHOPIFY_SHOP}/admin/api/${SHOPIFY_API_VERSION}/fulfillments.json?created_at_min=${fromDateStr}T00:00:00Z&limit=250`;

  while (nextPageUrl) {
    const shopifyResp = await fetch(nextPageUrl, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' }
    });
    const shopifyData = await shopifyResp.json() as { fulfillments?: Array<Record<string, unknown>> };
    (shopifyData.fulfillments || []).forEach(f => shopifyShipments.push(f));
    const linkHeader = shopifyResp.headers.get('link') || '';
    const nextMatch = linkHeader.match(/<([^>]+)>;s*rel="next"/);
    nextPageUrl = nextMatch ? nextMatch[1] : null;
  }

  // Step 5: Calculate stats per service and flag losses
  const flagged: unknown[] = [];
  const stats: Record<string, { count: number; totalCost: number; totalPaid: number }> = {};

  for (const fulfillment of shopifyShipments) {
    const tracking = fulfillment.tracking_number as string;
    const ss = tracking ? trackingMap.get(tracking) : undefined;
    if (!ss) continue;

    const state = (ss.shipTo?.state || '').toUpperCase();
    const shippingCost = (ss.shipmentCost || 0) + (ss.otherCost || 0);
    const service = matchService(ss.serviceCode || '');

    if (ignore48StateFreeShipping && STATES_48.has(state)) continue;

    if (!stats[service]) stats[service] = { count: 0, totalCost: 0, totalPaid: 0 };
    stats[service].count++;
    stats[service].totalCost += shippingCost;

    if (shippingCost > lossThreshold) {
      flagged.push({
        orderNumber: ss.orderNumber,
        tracking,
        service,
        shippingCost,
        state,
        shipDate: ss.shipDate
      });
    }
  }

  // Send Slack notification if enabled and flagged items found
  if (slackEnabled && flagged.length > 0 && SLACK_WEBHOOK) {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `⚠️ Shipping Cop: ${flagged.length} shipment(s) exceeded loss threshold of $${lossThreshold}\n${fromDateStr} → ${toDateStr}`
      })
    });
  }

  return {
    flagged,
    message: `Checked ${shipments.length} shipments. ${flagged.length} flagged.`,
    stats
  };
}

// ── Scheduler ─────────────────────────────────────────────────────────────

let _scTimer: ReturnType<typeof setInterval> | null = null;

export function startShippingCopScheduler(appRef: import('express').Application): void {
  if (_scTimer) return;
  _scTimer = setInterval(() => {
    const now = new Date();
    const cstParts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', weekday: 'short', hour12: false }).formatToParts(now);
    const dayStr = cstParts.find(p => p.type === 'weekday')?.value || '';
    const hour = parseInt(cstParts.find(p => p.type === 'hour')?.value || '0', 10);
    // Only run Mon-Fri, 8am-6pm CST
    if (!['Mon','Tue','Wed','Thu','Fri'].includes(dayStr) || hour < 8 || hour >= 18) return;
    const cfg: ShippingCopConfig = (appRef.locals.shippingCopConfig as ShippingCopConfig) || SHIPPING_COP_DEFAULTS;
    runShippingCop(cfg).catch((e: Error) => { console.error('[ShippingCop scheduler error]', e.message); });
  }, 1 * 60 * 60 * 1000);
  console.log('✅ Shipping Cop scheduler started (every 1hr, M-F 8-18 CST)');
}

// ── Router ────────────────────────────────────────────────────────────────

const router = Router();

// GET /shipping-cop — Config UI
router.get('/shipping-cop', (req: Request, res: Response) => {
  const cfg: ShippingCopConfig = (req.app.locals.shippingCopConfig as ShippingCopConfig) || SHIPPING_COP_DEFAULTS;
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Shipping Cop — WidgetCo</title>
  <style>
    body { font-family: 'Segoe UI', sans-serif; background: #f5f7fb; margin: 0; }
    .topbar { background: #1e3a7b; color: #fff; padding: 12px 24px; display: flex; align-items: center; gap: 14px; }
    .topbar a { color: #fff; text-decoration: none; font-size: 14px; opacity: .8; }
    .container { max-width: 700px; margin: 36px auto; padding: 0 20px; }
    h1 { color: #1e3a7b; font-size: 24px; margin-bottom: 6px; }
    .subtitle { color: #555; font-size: 14px; margin-bottom: 24px; }
    .card { background: #fff; border-radius: 10px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,.08); margin-bottom: 20px; }
    .card h2 { font-size: 16px; color: #1e3a7b; margin: 0 0 16px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; color: #444; margin-bottom: 4px; font-weight: 600; }
    input[type=number], input[type=text] { width: 100%; padding: 8px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
    .checkbox-row { display: flex; align-items: center; gap: 10px; }
    .checkbox-row input { width: auto; }
    .btn { background: #1e3a7b; color: #fff; border: none; padding: 10px 22px; border-radius: 6px; cursor: pointer; font-size: 14px; }
    .btn-run { background: #27ae60; margin-left: 10px; }
    .btn-debug { background: #7f8c8d; margin-left: 10px; }
    #result { margin-top: 16px; padding: 14px; background: #eafaf1; border-radius: 8px; font-size: 13px; display: none; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="topbar">
    <a href="/shipping/overview">← Shipping</a>
    <span>Shipping Cop</span>
  </div>
  <div class="container">
    <h1>Shipping Cop</h1>
    <p class="subtitle">Monitor shipping costs and flag orders that exceed the loss threshold. Runs automatically every hour on business days.</p>
    <div class="card">
      <h2>Configuration</h2>
      <form id="cfgForm">
        <div class="field">
          <label>Loss Threshold ($)</label>
          <input type="number" name="lossThreshold" value="${cfg.lossThreshold}" step="0.01" min="0">
        </div>
        <div class="field">
          <label>Lookback Hours</label>
          <input type="number" name="lookbackHours" value="${cfg.lookbackHours}" min="1" max="24">
        </div>
        <div class="field">
          <div class="checkbox-row">
            <input type="checkbox" name="ignore48StateFreeShipping" id="ignore48" ${cfg.ignore48StateFreeShipping ? 'checked' : ''}>
            <label for="ignore48">Ignore 48-state free shipping orders</label>
          </div>
        </div>
        <div class="field">
          <div class="checkbox-row">
            <input type="checkbox" name="slackEnabled" id="slackEnabled" ${cfg.slackEnabled ? 'checked' : ''}>
            <label for="slackEnabled">Send Slack notifications</label>
          </div>
        </div>
        <button type="submit" class="btn">Save Config</button>
        <button type="button" class="btn btn-run" onclick="runNow()">Run Now</button>
        <button type="button" class="btn btn-debug" onclick="runDebug()">Debug Trace</button>
      </form>
      <div id="result"></div>
    </div>
  </div>
  <script>
    document.getElementById('cfgForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      const body = {
        lossThreshold: parseFloat(this.lossThreshold.value),
        lookbackHours: parseInt(this.lookbackHours.value),
        ignore48StateFreeShipping: document.getElementById('ignore48').checked,
        slackEnabled: document.getElementById('slackEnabled').checked
      };
      const r = await fetch('/shipping-cop/save-config', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
      const d = await r.json();
      const el = document.getElementById('result');
      el.style.display = 'block';
      el.textContent = d.ok ? '✅ Config saved.' : '❌ ' + (d.error || 'Error');
    });
    async function runNow() {
      const el = document.getElementById('result');
      el.style.display = 'block';
      el.textContent = '⏳ Running...';
      const r = await fetch('/shipping-cop/run-now', { method: 'POST' });
      const d = await r.json();
      el.textContent = JSON.stringify(d, null, 2);
    }
    async function runDebug() {
      const el = document.getElementById('result');
      el.style.display = 'block';
      el.textContent = '⏳ Running debug trace...';
      const r = await fetch('/shipping-cop/debug-trace');
      const d = await r.json();
      el.textContent = JSON.stringify(d, null, 2);
    }
  </script>
</body>
</html>`);
});

// POST /shipping-cop/save-config — Save configuration
router.post('/shipping-cop/save-config', (req: Request, res: Response) => {
  const body = req.body as Partial<ShippingCopConfig>;
  const cfg: ShippingCopConfig = {
    lossThreshold: typeof body.lossThreshold === 'number' ? body.lossThreshold : SHIPPING_COP_DEFAULTS.lossThreshold,
    lookbackHours: typeof body.lookbackHours === 'number' ? body.lookbackHours : SHIPPING_COP_DEFAULTS.lookbackHours,
    ignore48StateFreeShipping: body.ignore48StateFreeShipping !== undefined ? Boolean(body.ignore48StateFreeShipping) : SHIPPING_COP_DEFAULTS.ignore48StateFreeShipping,
    slackEnabled: body.slackEnabled !== undefined ? Boolean(body.slackEnabled) : SHIPPING_COP_DEFAULTS.slackEnabled
  };
  req.app.locals.shippingCopConfig = cfg;
  res.json({ ok: true });
});

// POST /shipping-cop/run-now — Trigger immediate run
router.post('/shipping-cop/run-now', async (req: Request, res: Response) => {
  try {
    const cfg: ShippingCopConfig = (req.app.locals.shippingCopConfig as ShippingCopConfig) || SHIPPING_COP_DEFAULTS;
    const result = await runShippingCop(cfg);
    res.json({ success: true, flagged: result.flagged || [], message: result.message, stats: result.stats });
  } catch (err) {
    res.json({ error: (err as Error).message });
  }
});

// GET /shipping-cop/debug-trace — Step-by-step diagnostic trace
router.get('/shipping-cop/debug-trace', async (req: Request, res: Response) => {
  const trace: string[] = [];
  try {
    const SHIPSTATION_KEY = process.env.SHIPSTATION_API_KEY || '';
    const SHIPSTATION_SECRET = process.env.SHIPSTATION_API_SECRET || '';
    const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || '';
    const SHOPIFY_SHOP_DOMAIN = process.env.SHOPIFY_SHOP || '';
    const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-01';

    trace.push('Step 1: Checking env vars...');
    trace.push(`  SHIPSTATION_API_KEY: ${SHIPSTATION_KEY ? '✅ set' : '❌ missing'}`);
    trace.push(`  SHIPSTATION_API_SECRET: ${SHIPSTATION_SECRET ? '✅ set' : '❌ missing'}`);
    trace.push(`  SHOPIFY_ADMIN_ACCESS_TOKEN: ${SHOPIFY_TOKEN ? '✅ set' : '❌ missing'}`);
    trace.push(`  SHOPIFY_SHOP: ${SHOPIFY_SHOP_DOMAIN ? '✅ ' + SHOPIFY_SHOP_DOMAIN : '❌ missing'}`);

    const ssAuth = Buffer.from(`${SHIPSTATION_KEY}:${SHIPSTATION_SECRET}`).toString('base64');
    const now = new Date();
    const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const toDateStr = now.toISOString().split('T')[0];
    const fromDateStr = fromDate.toISOString().split('T')[0];

    trace.push(`Step 2: Querying ShipStation (date range ${fromDateStr} → ${toDateStr})...`);
    const ssUrl = `https://ssapi.shipstation.com/shipments?shipDateStart=${fromDateStr}&shipDateEnd=${toDateStr}&pageSize=5`;
    const ssResp = await fetch(ssUrl, { headers: { 'Authorization': 'Basic ' + ssAuth } });
    trace.push(`  ShipStation HTTP status: ${ssResp.status}`);
    const ssData = await ssResp.json() as { shipments?: unknown[]; message?: string };
    trace.push(`  ShipStation shipments returned: ${ssData.shipments ? ssData.shipments.length : 0}`);
    if (ssData.message) trace.push(`  ShipStation message: ${ssData.message}`);

    trace.push(`Step 3: Querying Shopify fulfillments...`);
    const shopifyUrl = `https://${SHOPIFY_SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/fulfillments.json?created_at_min=${fromDateStr}T00:00:00Z&limit=5`;
    const shopifyResp = await fetch(shopifyUrl, {
      headers: { 'X-Shopify-Access-Token': SHOPIFY_TOKEN, 'Content-Type': 'application/json' }
    });
    trace.push(`  Shopify HTTP status: ${shopifyResp.status}`);
    const shopifyData = await shopifyResp.json() as { fulfillments?: unknown[]; errors?: unknown };
    trace.push(`  Shopify fulfillments returned: ${shopifyData.fulfillments ? shopifyData.fulfillments.length : 0}`);
    if (shopifyData.errors) trace.push(`  Shopify errors: ${JSON.stringify(shopifyData.errors)}`);

    trace.push('Step 4: All checks complete.');
    res.json({ ok: true, trace });
  } catch (err) {
    trace.push(`ERROR: ${(err as Error).message}`);
    res.json({ ok: false, trace, error: (err as Error).message });
  }
});

export default router;
