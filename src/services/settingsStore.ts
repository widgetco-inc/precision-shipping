import { Pool } from 'pg';
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
  return _cachedSettings;
}

let _cachedSettings: AppSettings = migrateMissingServices(
  JSON.parse(JSON.stringify(defaultSettings)),
);
let _loaded = false;

export async function loadSettingsFromDb(): Promise<void> {
  try {
    await ensureTable();
    const res = await pool.query(
      "SELECT value FROM app_settings WHERE key = 'app'",
    );
    if (res.rows.length > 0) {
      const fromDb = res.rows[0].value as AppSettings;
      _cachedSettings = migrateMissingServices(fromDb);
      if ((_cachedSettings.packaging as any).weightFactor != null && _cachedSettings.packaging.packageWeightPct == null) {
        _cachedSettings.packaging.packageWeightPct = (_cachedSettings.packaging as any).weightFactor;
        console.log('[settingsStore] migrated packaging.weightFactor -> packageWeightPct:', _cachedSettings.packaging.packageWeightPct);
      }
      if (_cachedSettings.packaging.packageWeightPct <= 0.1) {
        _cachedSettings.packaging.packageWeightPct = 1.05;
      }
      const dp = defaultSettings.packaging;
      if (_cachedSettings.packaging.expressEnvelopeMaxWeightLb !== dp.expressEnvelopeMaxWeightLb) {
        _cachedSettings.packaging.expressEnvelopeMaxWeightLb = dp.expressEnvelopeMaxWeightLb;
        console.log('[settingsStore] migrated packaging.expressEnvelopeMaxWeightLb to ' + dp.expressEnvelopeMaxWeightLb);
      }
      if (_cachedSettings.packaging.useFedexEnvelopeForExpress !== dp.useFedexEnvelopeForExpress) {
        _cachedSettings.packaging.useFedexEnvelopeForExpress = dp.useFedexEnvelopeForExpress;
        console.log('[settingsStore] migrated packaging.useFedexEnvelopeForExpress to ' + dp.useFedexEnvelopeForExpress);
      }
      // Sync prefix-based skuBoxOverrides from defaultSettings (source of truth for prefixes).
      // Per-SKU exact overrides set via the UI toggle are preserved.
      const defaultPrefixes = new Set(
        (dp.skuBoxOverrides ?? []).map(o => o.skuPrefix.toUpperCase())
      );
      const uiOnlyOverrides = (_cachedSettings.packaging.skuBoxOverrides ?? []).filter(
        o => !defaultPrefixes.has(o.skuPrefix.toUpperCase())
      );
      const merged = [
        ...JSON.parse(JSON.stringify(dp.skuBoxOverrides ?? [])),
        ...uiOnlyOverrides,
      ];
      if (JSON.stringify(_cachedSettings.packaging.skuBoxOverrides) !== JSON.stringify(merged)) {
        _cachedSettings.packaging.skuBoxOverrides = merged;
        console.log('[settingsStore] synced skuBoxOverrides: ' + merged.length + ' entries (' + (dp.skuBoxOverrides ?? []).length + ' from defaults, ' + uiOnlyOverrides.length + ' from UI)');
      }
      // Sync closureDates from defaultSettings — default dates are always locked in.
      // Any UI-added custom dates (not in defaultSettings) are preserved on top.
      const defaultDateSet = new Set((defaultSettings.closureDates ?? []).map(d => d.date));
      const uiOnlyDates = (_cachedSettings.closureDates ?? []).filter(d => !defaultDateSet.has(d.date));
      const mergedDates = [
        ...JSON.parse(JSON.stringify(defaultSettings.closureDates ?? [])),
        ...uiOnlyDates,
      ].sort((a, b) => a.date.localeCompare(b.date));
      if (JSON.stringify(_cachedSettings.closureDates) !== JSON.stringify(mergedDates)) {
        _cachedSettings.closureDates = mergedDates;
        console.log('[settingsStore] synced closureDates: ' + mergedDates.length + ' total (' + (defaultSettings.closureDates ?? []).length + ' from defaults, ' + uiOnlyDates.length + ' custom)');
      }
      await _saveToDb(_cachedSettings);
    } else {
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
    for (const def of defaults) {
      if (!existing.has(def.code)) {
        current.push(def);
        mutated = true;
        console.log('[settingsStore] migrated service added: ' + carrier + '.' + def.code);
      }
    }
    for (let i = current.length - 1; i >= 0; i--) {
      if (!defaultCodes.has(current[i].code)) {
        console.log('[settingsStore] migrated service removed: ' + carrier + '.' + current[i].code);
        current.splice(i, 1);
        mutated = true;
      }
    }
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
