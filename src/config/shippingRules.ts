/**
 * shippingRules.ts
 *
 * WidgetCo Shipping Rules — single source of truth.
 * All rate filtering and labeling logic reads from this file.
 * To change a threshold or label, edit here only — no digging through code.
 */

export interface ZoneRules {
        suppressCarriers?: string[];
        suppressUspsOverSubtotal?: number;
        passThrough?: boolean;
        insureUsps?: boolean;
        flatTiers?: FlatTier[];
        calcTiers?: CalcTier[];
}

export interface FlatTier {
        label: string;
        price: number;          // USD — 0 = free
  minSubtotal?: number;   // inclusive
  maxSubtotal?: number;   // inclusive
}

export interface CalcTier {
        carriers: string[];
        cheapestOnly: boolean;
        overridePrice?: number; // USD — 0 = free; undefined = use EasyPost price
    minSubtotal?: number;
        maxSubtotal?: number;
}

// ---------------------------------------------------------------------------
// Zone definitions
// ---------------------------------------------------------------------------

/**
 * US 48 Contiguous States
 *
 * Standard Delivery and FedEx Ground are handled by Shopify's native
 * FedEx account — Precision Shipping only provides the three express
 * air services at calculated EasyPost rates.
 *
 * Calc tiers (all matching tiers evaluated and returned):
 *   All orders → FedEx 2Day® at real EasyPost rate
 *   All orders → FedEx Standard Overnight® at real EasyPost rate
 *   All orders → FedEx Priority Overnight® at real EasyPost rate
 *
 * USPS: always suppressed for US 48
 */
export const US_48_RULES: ZoneRules = {
        suppressCarriers: ['USPS'],
        calcTiers: [
                    // Express — always shown at real calculated rate (no subtotal restriction)
            { carriers: ['FedEx 2Day'], cheapestOnly: false },
            { carriers: ['FedEx Standard Overnight'], cheapestOnly: false },
            { carriers: ['FedEx Priority Overnight'], cheapestOnly: false },
                ],
};

/**
 * Canada
 * Pass through all EasyPost rates; suppress USPS on orders >= $100.
 */
export const CANADA_RULES: ZoneRules = {
        suppressCarriers: ['international mail'],
        passThrough: true,
        suppressUspsOverSubtotal: 100,
};

/**
 * US AK / HI / Territories & Armed Forces
 * Pass through all EasyPost rates; suppress USPS on orders >= $100.
 */
export const AK_HI_TERRITORY_RULES: ZoneRules = {
        passThrough: true,
        suppressUspsOverSubtotal: 100,
};

/**
 * Rest of World (international)
 * All carriers pass through at calculated rates.
 */
export const REST_OF_WORLD_RULES: ZoneRules = {
        suppressCarriers: ['international mail'],
        insureUsps: true,
        passThrough: true,
};
