/**
 * constants.ts
 *
 * Business-critical constants for WidgetCo Precision Shipping.
 * Single source of truth — import from here instead of hardcoding values.
 *
 * WHY THIS FILE EXISTS:
 * These values have historically been hardcoded in multiple places and
 * silently corrupted by code changes. Centralizing them here means there
 * is exactly ONE place to change, and the name makes the intent obvious.
 */

/**
 * WidgetCo ships all orders from Houston, TX 77204 (4800 Calhoun Rd).
 * This zip is used as the EasyPost shipment origin for rate calculations.
 *
 * DO NOT change this to a test/placeholder zip (e.g. 90210, 92806).
 * Doing so causes FedEx overnight rates to be calculated from the wrong
 * origin, making nearby destinations appear more expensive than distant ones.
 */
export const ORIGIN_ZIP = '77204';
