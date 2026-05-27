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
  price: number;        // USD — 0 = free
  minSubtotal?: number; // inclusive
  maxSubtotal?: number; // inclusive
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
 * Flat tiers (first match wins, exits immediately):
 *   < $35       → "Standard Delivery"  $4.95
 *   $35–$99.99  → "Standard Delivery"  Free
 *
 * Calc tiers (all matching tiers evaluated and returned):
 *   $100+       → FedEx Ground or UPS Ground (cheapest wins) — Free
 *   All orders  → FedEx 2Day               at real EasyPost rate
 *   All orders  → FedEx Standard Overnight  at real EasyPost rate
 *   All orders  → FedEx Priority Overnight  at real EasyPost rate
 *
 * USPS: always suppressed
 */
export const US_48_RULES: ZoneRules = {
  suppressCarriers: ['USPS'],
  flatTiers: [
    { label: 'Standard Delivery', price: 4.95, maxSubtotal: 34.99 },
    { label: 'Standard Delivery', price: 0,    minSubtotal: 35, maxSubtotal: 99.99 },
  ],
  calcTiers: [
    // $100+ — free ground, cheapest of FedEx Ground or UPS Ground
    {
      carriers: ['FedEx Ground', 'UPS Ground'],
      cheapestOnly: true,
      overridePrice: 0,
      minSubtotal: 100,
    },
    // Express — always shown at real calculated rate, no cheapest-only filtering
    { carriers: ['FedEx 2Day'],               cheapestOnly: false },
    { carriers: ['FedEx Standard Overnight'],  cheapestOnly: false },
    { carriers: ['FedEx Priority Overnight'],  cheapestOnly: false },
  ],
};

/**
 * Canada
 * Pass through all EasyPost rates; suppress USPS on orders >= $100.
 */
export const CANADA_RULES: ZoneRules = {
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
 * All carriers pass through at calculated rates; USPS always hidden.
 */
export const REST_OF_WORLD_RULES: ZoneRules = {
  suppressCarriers: ['USPS'],
  insureUsps: true,
  passThrough: true,
};
