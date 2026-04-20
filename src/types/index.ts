export type CarrierCode = 'fedex' | 'ups' | 'usps';

export interface ServiceRule {
  code: string;
  label: string;
  enabled: boolean;
  domesticOnly?: boolean;
  internationalOnly?: boolean;
  canadaOnly?: boolean;
  hiAkOnly?: boolean;
  excludeHiAk?: boolean;
  maxWeightLb?: number;
  minWeightLb?: number;
  handlingFeeUsd?: number;
  flatRateUsd?: number;
  freeThresholdUsd?: number;
  shipperAccount?: 'K' | 'F';
}

export interface CarrierSettings {
  enabled: boolean;
  services: ServiceRule[];
}

export interface PackagingSettings {
  packageWeightPct: number;
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
  address1?: string;
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
  packageWeightGrams: number;
  totalShipmentWeightGrams: number;
  totalShipmentWeightLb: number;
  destination: Destination;
  isDomestic: boolean;
  isCanada: boolean;
  isInternational: boolean;
  isHiAkTerritory: boolean;
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
