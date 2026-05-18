export type CarrierCode = 'fedex' | 'ups' | 'ups_f' | 'ups_one_rate' | 'usps' | 'dhl_ecomm' | 'dhl_express' | 'fedex_wallet' | 'asendia';

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

export interface SkuBoxOverride {
    /** SKU prefix to match — e.g. "6-U" matches any SKU starting with "6-U" */
  skuPrefix: string;
    /** If true, every unit ships in its own box (ignores maxWeightPerBoxLb) */
  shipsIndividually?: boolean;
    /** Max weight per box in lb — used when shipsIndividually is false/absent */
  maxWeightPerBoxLb?: number;
}

export interface PackagingSettings {
    packageWeightPct: number;
    expressEnvelopeMaxWeightLb: number;
    useFedexEnvelopeForExpress: boolean;
    maxWeightPerBoxLb?: number;
    skuBoxOverrides?: SkuBoxOverride[];
}

export interface AccessSettings {
    allowedAdminEmails: string[];
}

export interface ClosureDate {
    /** ISO date string YYYY-MM-DD */
  date: string;
    /** Human-readable label e.g. "Thanksgiving 2026" */
  label: string;
}

export interface AppSettings {
    carriers: Record<CarrierCode, CarrierSettings>;
    packaging: PackagingSettings;
    access: AccessSettings;
    /** Warehouse closure dates — used to compute estimated ship/delivery dates */
  closureDates?: ClosureDate[];
}

export interface Destination {
    countryCode: string;
    provinceCode?: string;
    postalCode: string;
    city?: string;
    address1?: string;
}

export interface CartLineInput {
    variantId: string;
    sku: string;
    title: string;
    quantity: number;
    trueWeightLbs?: number;
}

export interface ShipmentLine extends CartLineInput {
    resolvedWeightLbs: number;
}

export interface Shipment {
    lines: ShipmentLine[];
    totalItemWeightLbs: number;
    packageWeightLbs: number;
    totalShipmentWeightLbs: number;
    destination: Destination;
    isDomestic: boolean;
    isCanada: boolean;
    isInternational: boolean;
    isHiAkTerritory: boolean;
    eligibleForFedexEnvelope: boolean;
    numberOfBoxes: number;
    heaviestBoxWeightLb: number;
}

export interface RateQuote {
    carrier: CarrierCode;
    serviceCode: string;
    serviceName: string;
    amountUsd: number;
    currency: string;
    estDeliveryDays?: number | null;
    debug?: string;
}
