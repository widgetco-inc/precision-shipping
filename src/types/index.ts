export type CarrierCode = 'fedex' | 'ups' | 'usps';

export interface ServiceRule {
  code: string;
  label: string;
  enabled: boolean;
  domesticOnly?: boolean;
  internationalOnly?: boolean;
  canadaOnly?: boolean;
  maxWeightLb?: number;
  minWeightLb?: number;
  handlingFeeUsd?: number;
}

export interface CarrierSettings {
  enabled: boolean;
  services: ServiceRule[];
}

export interface PackagingSettings {
  defaultPackageTareLb: number;
  expressEnvelopeMaxWeightLb: number;
  useFedexEnvelopeForExpress: boolean;
}

export interface AccessSettings {
  allowedAdminEmails: string[];
}

export interface AppSettings {
  carriers: Record<CarrierCode, CarrierSettings>;
  packaging: PackagingSettings;
  access: AccessSettings;
}

export interface Destination {
  countryCode: string;
  provinceCode?: string;
  postalCode?: string;
  city?: string;
}

export interface CartLineInput {
  variantId?: string;
  sku?: string;
  title?: string;
  quantity: number;
  trueWeightGrams?: number;
}

export interface ShipmentLine extends CartLineInput {
  resolvedWeightGrams: number;
}

export interface Shipment {
  lines: ShipmentLine[];
  totalItemWeightGrams: number;
  packageTareGrams: number;
  totalShipmentWeightGrams: number;
  totalShipmentWeightLb: number;
  destination: Destination;
  isDomestic: boolean;
  isCanada: boolean;
  isInternational: boolean;
  eligibleForFedexEnvelope: boolean;
}

export interface RateQuote {
  carrier: CarrierCode;
  serviceCode: string;
  serviceName: string;
  amountUsd: number;
  currency: string;
  debug: string[];
}
