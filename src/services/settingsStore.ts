—																						—																																										—																																							—																																																																																																																																																																		import { Pool } from 'pg';
import { defaultSettings } from '../config/defaultSettings';
import { AppSettings } from '../types';

// Postgres-backed settings store — survives deployments.
// Falls back to defaultSettings on first run (before the table is seeded).
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export function getSettings(): AppSettings {
  // Sync wrapper: we can't make getSettings async without touching every caller,
  // so we cache the last known settings in memory and keep it fresh via a
  // background async load. On first call the cache is populated synchronously
  // from the in-memory default; the async load then overwrites it after the
  // first await resolves (within the same event loop tick for subsequent calls).
  return _cachedSettings;
}

let _cachedSettings: AppSettings = migrateMissingServices(
  JSON.parse(JSON.stringify(defaultSettings)),
);
let _loaded = false;

// Called once at server startup — populates cache from DB.
export async function loadSettingsFromDb(): Promise<void> {
  try {
    await ensureTable();
    const res = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'app'",
    );
    if (res.rows.length > 0) {
      const fromDb = res.rows[0].value as AppSettings;
      _cachedSettings = migrateMissingServices(fromDb);
              // Migrate legacy weightFactor -> packageWeightPct (key rename)
              if ((_cachedSettings.packaging as any).weightFactor != null && _cachedSettings.packaging.packageWeightPct == null) {
                          _cachedSettings.packaging.packageWeightPct = (_cachedSettings.packaging as any).weightFactor;
                          console.log('[settingsStore] migrated packaging.weightFactor -> packageWeightPct:', _cachedSettings.packaging.packageWeightPct);
              }
      // One-time fix: correct legacy packageWeightPct of 0.1 (wrong default) to 1.05 (+5% tare)
      if (_cachedSettings.packaging.packageWeightPct <= 0.1) {
        _cachedSettings.packaging.packageWeightPct = 1.05;
      }
      // Sync packaging fields from defaults if they are missing or stale
      const dp = defaultSettings.packaging;
      if (_cachedSettings.packaging.expressEnvelopeMaxWeightLb !== dp.expressEnvelopeMaxWeightLb) {
        _cachedSettings.packaging.expressEnvelopeMaxWeightLb = dp.expressEnvelopeMaxWeightLb;
        console.log('[settingsStore] migrated packaging.expressEnvelopeMaxWeightLb to ' + dp.expressEnvelopeMaxWeightLb);
      }
      if (_cachedSettings.packaging.useFedexEnvelopeForExpress !== dp.useFedexEnvelopeForExpress) {
        _cachedSettings.packaging.useFedexEnvelopeForExpress = dp.useFedexEnvelopeForExpress;
        console.log('[settingsStore] migrated packaging.useFedexEnvelopeForExpress to ' + dp.useFedexEnvelopeForExpress);
      }
      // Flush any migration changes back to DB
      await _saveToDb(_cachedSettings);
    } else {
      // First run — seed DB from defaults
      _cachedSettings = migrateMissingServices(
        JSON.parse(JSON.stringify(defaultSettings)),
      );
      await _saveToDb(_cachedSettings);
    }
    _loaded = true;
    console.log('[settingsStore] loaded from DB, carriers=' +
      Object.keys(_cachedSettings.carriers).join(','));
  } catch (err) {
    console.error('[settingsStore] DB load failed, using in-memory defaults:', err);
  }
}

async function _saveToDb(settings: AppSettings): Promise<void> {
  await ensureTable();
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('app', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb, updated_at = now()`,
    [JSON.stringify(settings)],
  );
}

export function saveSettings(settings: AppSettings): AppSettings {
  _cachedSettings = settings;
  // Fire-and-forget async save — returns immediately so the HTTP response
  // is not delayed by the DB round-trip.
  _saveToDb(settings).catch((err) =>
    console.error('[settingsStore] DB save failed:', err),
  );
  return settings;
}

function migrateMissingServices(settings: AppSettings): AppSettings {
  let mutated = false;
  const carriers = Object.keys(defaultSettings.carriers) as Array<keyof typeof defaultSettings.carriers>;
  for (const carrier of carriers) {
    if (!settings.carriers[carrier]) {
      (settings.carriers as any)[carrier] = JSON.parse(JSON.stringify(defaultSettings.carriers[carrier]));
      mutated = true;
      console.log('[settingsStore] migrated carrier added: ' + carrier);
      continue;
    }
    const defaults = defaultSettings.carriers[carrier].services;
    const current = settings.carriers[carrier].services;
    const defaultCodes = new Set(defaults.map((s) => s.code));
    const existing = new Set(current.map((s) => s.code));

    // Add missing services
    for (const def of defaults) {
      if (!existing.has(def.code)) {
        current.push(def);
        mutated = true;
        console.log('[settingsStore] migrated service added: ' + carrier + '.' + def.code);
      }
    }

    // Remove obsolete services
    for (let i = current.length - 1; i >= 0; i--) {
      if (!defaultCodes.has(current[i].code)) {
        console.log('[settingsStore] migrated service removed: ' + carrier + '.' + current[i].code);
        current.splice(i, 1);
        mutated = true;
      }
    }

    // Sync static metadata from defaults onto existing services (never touches 'enabled')
    for (const def of defaults) {
      const existing_svc = current.find((s) => s.code === def.code);
      if (existing_svc) {
        const staticKeys: Array<keyof typeof def> = ['air', 'domesticOnly', 'internationalOnly', 'canadaOnly', 'excludeHiAk', 'maxWeightLb', 'minWeightLb', 'label'];
        for (const key of staticKeys) {
          if (def[key] !== undefined && (existing_svc as any)[key] !== def[key]) {
            (existing_svc as any)[key] = def[key];
            mutated = true;
            console.log('[settingsStore] migrated service prop synced: ' + carrier + '.' + def.code + '.' + key);
          } else if (def[key] === undefined && (existing_svc as any)[key] !== undefined) {
            delete (existing_svc as any)[key];
            mutated = true;
            console.log('[settingsStore] migrated service prop removed: ' + carrier + '.' + def.code + '.' + key);
          }
        }
      }
    }
  }
  if (mutated) console.log('[settingsStore] migration applied changes');
  return settings;
}
