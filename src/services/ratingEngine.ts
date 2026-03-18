import { getSettings } from './settingsStore';
import { resolveTrueWeightGrams } from './catalog';
import { CartLineInput, Destination, Shipment, ShipmentLine } from '../types';

const GRAMS_PER_LB = 453.59237;

export function buildShipment(lines: CartLineInput[], destination: Destination): Shipment {
  const settings = getSettings();

  const shipmentLines: ShipmentLine[] = lines.map((line) => {
    const resolvedWeightGrams = resolveTrueWeightGrams(line.variantId, line.sku, line.trueWeightGrams);
    return { ...line, resolvedWeightGrams };
  });

  const totalItemWeightGrams = shipmentLines.reduce(
    (sum, line) => sum + (line.resolvedWeightGrams * line.quantity),
    0
  );

  const packageTareGrams = settings.packaging.defaultPackageTareLb * GRAMS_PER_LB;
  const totalShipmentWeightGrams = totalItemWeightGrams + packageTareGrams;
  const totalShipmentWeightLb = totalShipmentWeightGrams / GRAMS_PER_LB;
  const isCanada = destination.countryCode.toUpperCase() === 'CA';
  const isDomestic = ['US', 'USA'].includes(destination.countryCode.toUpperCase());
  const isInternational = !isDomestic;
  const eligibleForFedexEnvelope =
    settings.packaging.useFedexEnvelopeForExpress && totalShipmentWeightLb <= settings.packaging.expressEnvelopeMaxWeightLb;

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
    eligibleForFedexEnvelope
  };
}
