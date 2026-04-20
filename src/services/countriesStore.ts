import fs from 'node:fs';
import path from 'node:path';

export interface CountryEntry {
    code: string;
  name: string;
}

export interface CountriesData {
    lastSyncedAt: string | null;
  source: string;
  countries: CountryEntry[];
}

const DATA_PATH = path.join(process.cwd(), 'data', 'shopify-countries.json');

const FALLBACK: CountriesData = {
  lastSyncedAt: null,
  source: 'fallback (file missing or unreadable)',
  countries: [
{ code: 'US', name: 'United States' },
{ code: 'CA', name: 'Canada' },
{ code: 'GB', name: 'United Kingdom' }
  ]
};

export function getCountries(): CountriesData {
  try {
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CountriesData;
    if (!Array.isArray(parsed.countries) || parsed.countries.length === 0) {
      return FALLBACK;
}
    return parsed;
} catch (err) {
    console.error('[countriesStore] Failed to load shopify-countries.json, using fallback:', err);
    return FALLBACK;
}
}
