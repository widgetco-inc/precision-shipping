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

  // Box splitting: per-SKU overrides take priority, then global default
  const overrides = settings.packaging.skuBoxOverrides ?? [];

  // Check if ANY line matches a shipsIndividually override
  // If so: numberOfBoxes = total units across all individually-shipping lines,
  //         heaviestBoxWeightLb = weight of the single heaviest unit
  let individualBoxCount = 0;
  let heaviestUnitLb = 0;
  for (const line of shipmentLines) {
    const sku = (line.sku ?? '').toUpperCase();
    const match = overrides.find((ov) => ov.shipsIndividually && sku.startsWith(ov.skuPrefix.toUpperCase()));
    if (match) {
      individualBoxCount += line.quantity;
      const unitLb = (line.resolvedWeightGrams * settings.packaging.packageWeightPct) / 453.59237;
      if (unitLb > heaviestUnitLb) heaviestUnitLb = unitLb;
    }
  }

  let numberOfBoxes: number;
  let heaviestBoxWeightLb: number;

  if (individualBoxCount > 0) {
    // All items in this order are individually boxed
    numberOfBoxes = individualBoxCount;
    heaviestBoxWeightLb = heaviestUnitLb > 0 ? heaviestUnitLb : totalShipmentWeightLb / numberOfBoxes;
  } else {
    // No individually-shipping SKUs — use weight-based box splitting
    let maxLbPerBox = settings.packaging.maxWeightPerBoxLb ?? 45;
    for (const line of shipmentLines) {
      const sku = (line.sku ?? '').toUpperCase();
      for (const ov of overrides) {
        if (!ov.shipsIndividually && ov.maxWeightPerBoxLb != null && sku.startsWith(ov.skuPrefix.toUpperCase())) {
          maxLbPerBox = Math.min(maxLbPerBox, ov.maxWeightPerBoxLb);
          break;
        }
      }
    }
    numberOfBoxes = Math.max(1, Math.ceil(totalShipmentWeightLb / maxLbPerBox));
    heaviestBoxWeightLb = totalShipmentWeightLb / numberOfBoxes;
  }
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
