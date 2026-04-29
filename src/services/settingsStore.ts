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
          // Add missing services
      for (const def of defaults) {
              if (!existing.has(def.code)) { current.push(def); mutated = true; console.log('[settingsStore] migrated service added: ' + carrier + '.' + def.code); }
      }
          // Remove obsolete services
      for (let i = current.length - 1; i >= 0; i--) {
              if (!defaultCodes.has(current[i].code)) {
                        console.log('[settingsStore] migrated service removed: ' + carrier + '.' + current[i].code);
                        current.splice(i, 1);
                        mutated = true;
              }
      }
          // Sync static metadata (air, domesticOnly, internationalOnly, etc.) from defaults onto existing services
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
                                                  // Remove property if no longer in default (e.g. air flag removed)
                                      delete (existing_svc as any)[key];
                                                  mutated = true;
                                                  console.log('[settingsStore] migrated service prop removed: ' + carrier + '.' + def.code + '.' + key);
                                    }
                        }
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
