# Architecture & Decision Log

This file documents critical architectural decisions for the `precision-shipping` Shopify app.
Its purpose is to give future developers and AI assistants the context they need to avoid
accidentally reverting hard-won fixes.

---

## DECISION 1: Origin ZIP is always 77204 (Houston, TX)

**What:** All shipping rate calculations must originate from ZIP code `77204`.

**Why:** WidgetCo ships all orders from its Houston facility at 4800 Calhoun Rd, Houston TX 77204.
EasyPost requires a `from_zip` to calculate accurate carrier rates. If this is wrong, every
rate returned will be based on the wrong origin, making nearby destinations appear expensive
and distant destinations appear cheap.

**History:** The default fallback in `src/carriers/easypost.ts` was accidentally set to `92806`
(Anaheim, CA). This caused Houston delivery addresses to show overnight rates ~$49 (cross-country
from Anaheim) while Beverly Hills showed ~$30 (local from Anaheim) — the exact opposite of
correct pricing.

**Implementation:**
- `src/config/constants.ts` exports `ORIGIN_ZIP = '77204'` as the single source of truth
- `src/carriers/easypost.ts` imports and uses `ORIGIN_ZIP` as the default fallback for `fromZip`
- `src/routes/carrier.ts` explicitly passes `ORIGIN_ZIP` when calling `getRates()`
- `.github/workflows/origin-zip-guard.yml` CI workflow blocks any push that changes this

**Do NOT change** `ORIGIN_ZIP` unless WidgetCo physically relocates its warehouse.

---

## DECISION 2: Only FedEx and USPS in CARRIER_ACCOUNTS

**What:** `CARRIER_ACCOUNTS` in `src/carriers/easypost.ts` must only contain `fedex` and `usps`.

**Why:** WidgetCo only has active EasyPost carrier accounts for FedEx and USPS.
Adding UPS, DHL, Asendia, or other carriers to this array causes EasyPost API errors
(invalid/unauthorized carrier account) and can break the entire rate-fetch pipeline.

**Do NOT add** other carriers unless a new EasyPost carrier account has been explicitly set up
and confirmed active.

---

## DECISION 3: US 48 States do NOT use EasyPost pass-through

**What:** For the contiguous US 48 states, only FedEx 2Day, Standard Overnight, and Priority
Overnight are shown — not a full EasyPost pass-through of all available rates.

**Why:** WidgetCo's Shopify store has a native FedEx carrier account connected that already
displays FedEx Ground / Home Delivery for domestic orders. If `precision-shipping` also passed
through FedEx Ground rates via EasyPost, customers would see duplicate ground shipping options
at checkout — confusing and incorrect.

**Implementation:** `src/config/shippingRules.ts` defines `US_48_RULES` using `calcTiers`
(not `passThrough`) with only the three express overnight services explicitly listed.
Canada, AK/HI/Territories, and Rest of World use `passThrough: true` because there is no
native Shopify carrier overlap for those zones.

**Do NOT change** US 48 to pass-through without first removing or disabling the native Shopify
FedEx carrier account to avoid duplicate rates.

---

## DECISION 4: FedEx Overnight displays on weekends

**What:** FedEx Overnight options (Standard Overnight, Priority Overnight) must always display
at checkout, including Saturday and Sunday.

**Why:** Orders placed after 4pm CST Friday will ship the next business day (Monday) and deliver
Tuesday — which is correctly labeled "1 business day" in checkout. The checkout page already
states: "Orders before 4pm CST ship same business day." Suppressing overnight options on weekends
removes a valid and needed shipping choice from customers.

**Do NOT** add weekend date logic that hides or disables overnight options on Saturday/Sunday.

---

## DECISION 5: SKU prefix for individually-shipped items is 6-U

**What:** In `src/config/defaultSettings.ts`, the `shipsIndividually` SKU prefix is `6-U`.

**Why:** Product SKUs starting with `6-U` are items that ship individually (each unit gets its
own shipment/label). This was changed from `6-W` to `6-U` to match actual product catalog SKUs.

**Do NOT revert** this to `6-W`.

---

## CI Guard

The workflow at `.github/workflows/origin-zip-guard.yml` runs on every push and PR to `main`.
It verifies:
1. `ORIGIN_ZIP` in `constants.ts` equals `'77204'`
2. `easypost.ts` imports `ORIGIN_ZIP` (not a hardcoded ZIP string)
3. `carrier.ts` passes `ORIGIN_ZIP` to `getRates`
4. No stale placeholder ZIPs (92806, 90210, etc.) appear as `fromZip` defaults

A failing CI check will block merging to `main` (enforced by the "Protect main branch" branch ruleset).

---

*Last updated: 2026-06-06*
