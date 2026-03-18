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
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as AppSettings;
}

export function saveSettings(settings: AppSettings): AppSettings {
  ensureStore();
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2));
  return settings;
}
