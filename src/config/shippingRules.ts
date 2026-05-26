/**
 * shippingRules.ts
  *
   * WidgetCo Shipping Rules — single source of truth.
    * All rate filtering and labeling logic reads from this file.
     * To change a threshold or label, edit here only — no digging through code.
      */

      export interface ZoneRules {
        /** Carrier names to always suppress (exact match on serviceName from EasyPost) */
          suppressCarriers?: string[];
            /** Suppress USPS when order subtotal >= this value (undefined = never suppress by subtotal) */
              suppressUspsOverSubtotal?: number;
                /** If true, pass EasyPost rates through with no other transformation */
                  passThrough?: boolean;
                    /** Add insurance to USPS shipments (safety net — applies only if USPS is not suppressed) */
                      insureUsps?: boolean;
                        /** Flat-rate tiers applied in order; first match wins */
                          flatTiers?: FlatTier[];
                            /** Calculated tiers: call EasyPost, pick cheapest among allowed carriers, override price */
                              calcTiers?: CalcTier[];
                              }

                              export interface FlatTier {
                                label: string;
                                  price: number; // USD — 0 = free
                                    minSubtotal?: number; // inclusive
                                      maxSubtotal?: number; // inclusive
                                      }

                                      export interface CalcTier {
                                        /** Only return the single cheapest rate among these carriers */
                                          carriers: string[];
                                            cheapestOnly: boolean;
                                              /** Override the price (USD). 0 = free. undefined = use EasyPost price */
                                                overridePrice?: number;
                                                  minSubtotal?: number;
                                                    maxSubtotal?: number;
                                                    }

                                                    // ---------------------------------------------------------------------------
                                                    // Zone definitions
                                                    // ---------------------------------------------------------------------------

                                                    /**
                                                     * US 48 Contiguous States
                                                      *
                                                       * Rules (in priority order):
                                                        *   1. Subtotal < $35       → "Standard Delivery"  $4.95 flat
                                                         *   2. Subtotal $35–$99.99  → "Standard Delivery"  Free
                                                          *   3. Subtotal >= $100     → FedEx Ground or UPS Ground (cheapest) — Free
                                                           *   USPS: always hidden
                                                            */
                                                            export const US_48_RULES: ZoneRules = {
                                                              suppressCarriers: ['USPS'],
                                                              flatTiers: [
                                                                { label: 'Standard Delivery', price: 4.95, maxSubtotal: 34.99 },
                                                                { label: 'Standard Delivery', price: 0, minSubtotal: 35, maxSubtotal: 99.99 },
                                                              ],
                                                              calcTiers: [
                                                                // $100+ — free ground shipping, cheapest of FedEx Ground or UPS Ground
                                                                {
                                                                  carriers: ['FedEx Ground', 'UPS Ground'],
                                                                  cheapestOnly: true,
                                                                  overridePrice: 0,
                                                                  minSubtotal: 100,
                                                                },
                                                                // Premium FedEx — always shown at real calculated rate (all subtotals)
                                                                {
                                                                  carriers: ['FedEx 2Day'],
                                                                  cheapestOnly: false,
                                                                },
                                                                {
                                                                  carriers: ['FedEx Standard Overnight'],
                                                                  cheapestOnly: false,
                                                                },
                                                                {
                                                                  carriers: ['FedEx Priority Overnight'],
                                                                  cheapestOnly: false,
                                                                },
                                                              ],
}/**
 * shippingRules.ts
  *
   * WidgetCo Shipping Rules — single source of truth.
    * All rate filtering and labeling logic reads from this file.
     * To change a threshold or label, edit here only — no digging through code.
      */

      export interface ZoneRules {
        /** Carrier names to always suppress (exact match on serviceName from EasyPost) */
          suppressCarriers?: string[];
            /** Suppress USPS when order subtotal >= this value (undefined = never suppress by subtotal) */
              suppressUspsOverSubtotal?: number;
                /** If true, pass EasyPost rates through with no other transformation */
                  passThrough?: boolean;
                    /** Add insurance to USPS shipments (safety net — applies only if USPS is not suppressed) */
                      insureUsps?: boolean;
                        /** Flat-rate tiers applied in order; first match wins */
                          flatTiers?: FlatTier[];
                            /** Calculated tiers: call EasyPost, pick cheapest among allowed carriers, override price */
                              calcTiers?: CalcTier[];
                              }

                              export interface FlatTier {
                                label: string;
                                  price: number; // USD — 0 = free
                                    minSubtotal?: number; // inclusive
                                      maxSubtotal?: number; // inclusive
                                      }

                                      export interface CalcTier {
                                        /** Only return the single cheapest rate among these carriers */
                                          carriers: string[];
                                            cheapestOnly: boolean;
                                              /** Override the price (USD). 0 = free. undefined = use EasyPost price */
                                                overridePrice?: number;
                                                  minSubtotal?: number;
                                                    maxSubtotal?: number;
                                                    }

                                                    // ---------------------------------------------------------------------------
                                                    // Zone definitions
                                                    // ---------------------------------------------------------------------------

                                                    /**
                                                     * US 48 Contiguous States
                                                      *
                                                       * Rules (in priority order):
                                                        *   1. Subtotal < $35       → "Standard Delivery"  $4.95 flat
                                                         *   2. Subtotal $35–$99.99  → "Standard Delivery"  Free
                                                          *   3. Subtotal >= $100     → FedEx Ground or UPS Ground (cheapest) — Free
                                                           *   USPS: always hidden
                                                            */
                                                           
/**
                                                                                                               * Canada
                                                                                                                *
                                                                                                                 * Rules:
                                                                                                                  *   - Pass through all EasyPost rates
                                                                                                                   *   - Suppress USPS when subtotal >= $100
                                                                                                                    */
                                                                                                                    export const CANADA_RULES: ZoneRules = {
                                                                                                                      passThrough: true,
                                                                                                                        suppressUspsOverSubtotal: 100,
                                                                                                                        };
                                                                                                                        
                                                                                                                        /**
                                                                                                                         * US AK / HI / Territories & Armed Forces
                                                                                                                          *
                                                                                                                           * Rules:
                                                                                                                            *   - Pass through all EasyPost rates
                                                                                                                             *   - Suppress USPS when subtotal >= $100
                                                                                                                              */
                                                                                                                              export const AK_HI_TERRITORY_RULES: ZoneRules = {
                                                                                                                                passThrough: true,
                                                                                                                                  suppressUspsOverSubtotal: 100,
                                                                                                                                  };
                                                                                                                                  
                                                                                                                                  /**
                                                                                                                                   * Rest of World (international)
                                                                                                                                    *
                                                                                                                                     * Rules:
                                                                                                                                      *   - USPS always hidden
                                                                                                                                       *   - insureUsps: true is a safety net in case USPS is ever re-enabled
                                                                                                                                        *   - All other carriers pass through at calculated rates
                                                                                                                                         */
                                                                                                                                         export const REST_OF_WORLD_RULES: ZoneRules = {
                                                                                                                                           suppressCarriers: ['USPS'],
                                                                                                                                             insureUsps: true, // safety net only — USPS is suppressed above
                                                                                                                                               passThrough: true,
                                                                                                                                               };
                                                                                                                                               
