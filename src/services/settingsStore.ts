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
    console.log('[settingsStore] getSettings file=' + filePath + ' ups_codes=' + settings.carriers.ups.services.map(s => s.code).join(','));
  return migrateMissingServices(settings);
}
function migrateMissingServices(settings: AppSettings): AppSettings {
  let mutated = false;
  const carriers = Object.keys(defaultSettings.carriers) as Array<keyof typeof defaultSettings.carriers>;
  for (const carrier of carriers) {
    const defaults = defaultSettings.carriers[carrier].services;
    const current = settings.carriers[carrier].services;
    const existing = new Set(current.map((s) => s.code));
    for (const def of defaults) {
      if (!existing.has(def.code)) { current.push(def); mutated = true; console.log('[settingsStore] migrated: ' + carrier + '.' + def.code); }    
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
