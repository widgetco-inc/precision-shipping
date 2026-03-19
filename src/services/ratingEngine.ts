import { getSettings } from './settingsStore';
import { resolveTrueWeightGrams } from './catalog';
import { CartLineInput, Destination, Shipment, ShipmentLine } from '../types';

const GRAMS_PER_LB = 453.59237;

export async function buildShipment(
  lines: CartLineInput[],
  destination: Destination
): Promise<Shipment> {
  const settings = getSettings();

  const shipmentLines: ShipmentLine[] = await Promise.all(
    lines.map(async (line) => {
      const resolvedWeightGrams = await resolveTrueWeightGrams(
        line.variantId,
        line.sku,
        line.trueWeightGrams
      );
      return { ...line, resolvedWeightGrams };
    })
  );

  const totalItemWeightGrams = shipmentLines.reduce(
    (sum, line) => sum + line.resolvedWeightGrams * line.quantity,
    0
  );

  const packageTareGrams =
    settings.packaging.defaultPackageTareLb * GRAMS_PER_LB;
  const totalShipmentWeightGrams = totalItemWeightGrams + packageTareGrams;
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
    packageTareGrams,
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
