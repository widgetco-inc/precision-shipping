import fs from 'fs';
import path from 'path';
import { defaultSettings } from '../config/defaultSettings';
import { AppSettings } from '../types';

const dataDir = path.join(process.cwd(), 'data');
const filePath = path.join(dataDir, 'settings.json');

function ensureStore(): void {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify(defaultSettings, null, 2));
}

export function getSettings(): AppSettings {
  ensureStore();
  const settings = JSON.parse(fs.readFileSync(filePath, 'utf8')) as AppSettings;
  console.log('[settingsStore] getSettings file=' + filePath + ' carrier_keys=' + Object.keys(settings.carriers).join(','));
  return migrateMissingServices(settings);
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
      if (!existing.has(def.code)) { current.push(def); mutated = true; console.log('[settingsStore] migrated service added: ' + carrier + '.' + def.code); }
    }
    for (let i = current.length - 1; i >= 0; i--) {
      if (!defaultCodes.has(current[i].code)) {
        console.log('[settingsStore] migrated service removed: ' + carrier + '.' + current[i].code);
        current.splice(i, 1);
        mutated = true;
      }
    }
  }
  if (mutated) fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  return settings;
}

export function saveSettings(settings: AppSettings): AppSettings {
  ensureStore();
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  return settings;
}
