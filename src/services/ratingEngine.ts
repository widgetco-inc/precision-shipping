import { getSettings } from './settingsStore';
import { resolveWeightsBatch } from './catalog';
import { CartLineInput, Destination, Shipment, ShipmentLine } from '../types';

const GRAMS_PER_LB = 453.59237;

export async function buildShipment(
    lines: CartLineInput[],
    destination: Destination
  ): Promise<Shipment> {
    const settings = getSettings();

  // Collect all unique variant IDs and batch-fetch their weights in one API call
  const variantIds = lines
      .map((l) => l.variantId)
      .filter((id): id is string => Boolean(id));

  const weightMap = await resolveWeightsBatch(variantIds);

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

  const packageWeightGrams =
        totalItemWeightGrams * settings.packaging.packageWeightPct;
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
  };
}
