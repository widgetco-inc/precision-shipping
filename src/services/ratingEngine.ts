import { getSettings } from './settingsStore';
import { resolveWeightsBatch } from './catalog';
import { CartLineInput, Destination, Shipment, ShipmentLine } from '../types';

const GRAMS_PER_LB = 453.59237;

export async function buildShipment(
    lines: CartLineInput[],
    destination: Destination
): Promise<Shipment> {
  const settings = getSettings();

  // Collect all unique variant IDs and build a variantId->sku map for DB lookup
  const variantIds = lines
    .map((l) => l.variantId)
    .filter((id): id is string => Boolean(id));

  // Build skuMap: variantId -> sku (used by catalog.ts for DB-first weight lookup)
  const skuMap = new Map<string, string>();
  for (const line of lines) {
    if (line.variantId && line.sku) {
      skuMap.set(line.variantId, line.sku);
    }
  }

  const weightMap = await resolveWeightsBatch(variantIds, skuMap);

  const shipmentLines: ShipmentLine[] = lines.map((line) => {
    // If caller provided a direct weight, use it; otherwise use batched result
                    let resolvedWeightGrams: number;
    if (typeof line.trueWeightGrams === 'number' && line.trueWeightGrams > 0) {
      resolvedWeightGrams = line.trueWeightGrams;
    } else if (line.variantId) {
      resolvedWeightGrams = weightMap.get(line.variantId) ?? 0;
    } else {
      resolvedWeightGrams = 0;
    }
    return { ...line, resolvedWeightGrams };
  });

  const totalItemWeightGrams = shipmentLines.reduce(
    (sum, line) => sum + line.resolvedWeightGrams * line.quantity,
    0
  );
  const packageWeightGrams = totalItemWeightGrams * (settings.packaging.packageWeightPct - 1);
  const totalShipmentWeightGrams = totalItemWeightGrams + packageWeightGrams;
  const totalShipmentWeightLb = totalShipmentWeightGrams / GRAMS_PER_LB;

  const countryUpper = destination.countryCode.toUpperCase();
  const isCanada = countryUpper === 'CA';
  const isDomestic = countryUpper === 'US' || countryUpper === 'USA';
  const isInternational = !isDomestic;

  // HI / AK / territory detection
  const hiAkTerritories = ['HI','AK','PR','GU','VI','AS','MP','UM'];
  const province = (destination.provinceCode ?? '').toUpperCase();
  const isHiAkTerritory = isDomestic && hiAkTerritories.includes(province);

  // Box splitting: divide shipment weight across 45 lb boxes
  const maxLbPerBox = settings.packaging.maxWeightPerBoxLb ?? 45;
  const numberOfBoxes = Math.max(1, Math.ceil(totalShipmentWeightLb / maxLbPerBox));
  const heaviestBoxWeightLb = totalShipmentWeightLb / numberOfBoxes;

  const eligibleForFedexEnvelope =
    settings.packaging.useFedexEnvelopeForExpress &&
    totalShipmentWeightLb <= settings.packaging.expressEnvelopeMaxWeightLb;

  return {
    lines: shipmentLines,
    totalItemWeightGrams,
    packageWeightGrams,
    totalShipmentWeightGrams,
    totalShipmentWeightLb,
    destination,
    isDomestic,
    isCanada,
    isInternational,
    isHiAkTerritory,
    eligibleForFedexEnvelope,
    numberOfBoxes,
    heaviestBoxWeightLb,
  };
}
