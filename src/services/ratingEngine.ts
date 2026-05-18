import { getSettings } from './settingsStore';
import { resolveWeightsBatch, lookupUploadedWeightBySku } from './catalog';
import { CartLineInput, Destination, Shipment, ShipmentLine } from '../types';

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

  // SKU-only weight lookup for lines without a variantId (e.g. estimator)
  const skuOnlyWeightMap = new Map<string, number>();
      for (const line of lines) {
              if (!line.variantId && line.sku) {
                        const lb = await lookupUploadedWeightBySku(line.sku);
                        if (lb !== null) skuOnlyWeightMap.set(line.sku.toUpperCase(), lb);
              }
      }

  const shipmentLines: ShipmentLine[] = lines.map((line) => {
          // If caller provided a direct weight, use it; otherwise use batched result
                                                      let resolvedWeightLbs: number;
          if (typeof line.trueWeightLbs === 'number' && line.trueWeightLbs > 0) {
                    resolvedWeightLbs = line.trueWeightLbs;
          } else if (line.variantId) {
                    resolvedWeightLbs = weightMap.get(line.variantId) ?? 0;
          } else if (line.sku) {
                    resolvedWeightLbs = skuOnlyWeightMap.get(line.sku.toUpperCase()) ?? 0;
          } else {
                    resolvedWeightLbs = 0;
          }
          return { ...line, resolvedWeightLbs };
  });

  const totalItemWeightLbs = shipmentLines.reduce(
          (sum, line) => sum + line.resolvedWeightLbs * line.quantity,
          0
        );
      const packageWeightLbs = totalItemWeightLbs * (settings.packaging.packageWeightPct - 1);
      const totalShipmentWeightLbs = totalItemWeightLbs + packageWeightLbs;

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
  let individualBoxCount = 0;
      let heaviestUnitLb = 0;
      for (const line of shipmentLines) {
              const sku = (line.sku ?? '').toUpperCase();
              const match = overrides.find((ov) => ov.shipsIndividually && sku.startsWith(ov.skuPrefix.toUpperCase()));
              if (match) {
                        individualBoxCount += line.quantity;
                        const unitLb = line.resolvedWeightLbs * settings.packaging.packageWeightPct;
                        if (unitLb > heaviestUnitLb) heaviestUnitLb = unitLb;
              }
      }

  let numberOfBoxes: number;
      let heaviestBoxWeightLb: number;

  if (individualBoxCount > 0) {
          numberOfBoxes = individualBoxCount;
          heaviestBoxWeightLb = heaviestUnitLb > 0 ? heaviestUnitLb : totalShipmentWeightLbs / numberOfBoxes;
  } else {
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
          numberOfBoxes = Math.max(1, Math.ceil(totalShipmentWeightLbs / maxLbPerBox));
          heaviestBoxWeightLb = totalShipmentWeightLbs / numberOfBoxes;
  }

  const eligibleForFedexEnvelope =
          settings.packaging.useFedexEnvelopeForExpress &&
          totalShipmentWeightLbs <= settings.packaging.expressEnvelopeMaxWeightLb;

  return {
          lines: shipmentLines,
          totalItemWeightLbs,
          packageWeightLbs,
          totalShipmentWeightLbs,
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
