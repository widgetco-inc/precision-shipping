# WidgetCo Precision Shipping App

A Railway-ready custom Shopify app scaffold for WidgetCo that:
- calculates shipment weight from **true micro-weights** instead of Shopify's rounded catalog weights
- returns custom checkout rates through a Shopify **Carrier Service** callback
- supports FedEx, UPS, and USPS service toggles with sensible defaults
- includes a simple admin UI for settings, preview, and access control

## Why this app exists
Shopify carrier-calculated shipping can be distorted when very light products round to 0 g at the variant level. This app calculates weight at the **shipment level** instead:

`true unit weight x quantity + package tare`

That corrected shipment weight can then be used to request live carrier rates.

## What is production-ready vs scaffolded
### Included now
- Shopify Carrier Service callback endpoint
- real weight engine
- service visibility rules for the shipping methods WidgetCo listed
- simple admin UI with access lock for approved admins
- Railway-friendly Node/TypeScript app structure
- settings and preview API
- carrier adapter interface ready for live FedEx / UPS / USPS API integration

### Still needs your final wiring
- replace demo storage with a database
- connect actual product/variant micro-weight data (recommended: Shopify variant metafields)
- wire live FedEx / UPS / USPS API credentials and exact carrier payloads
- optionally register the embedded app inside Shopify Admin using your preferred app template/workflow

## Key Shopify notes
Shopify's Carrier Service feature is what creates real-time custom shipping rates at checkout. Delivery Customization can reorder, hide, or rename delivery options, but it does not create new shipping rates. Shopify's older private app model is deprecated; build this as a custom app instead. citeturn514197search12turn514197search8

## App structure
- `src/server.ts` - Express app
- `src/routes/` - admin UI, preview, carrier callback, settings APIs
- `src/services/ratingEngine.ts` - shipment-level calculation logic
- `src/carriers/` - carrier adapters
- `src/shopify.ts` - Shopify GraphQL helpers and carrier service registration
- `src/config/defaultSettings.ts` - editable shipping defaults

## Run locally
```bash
cp .env.example .env
npm install
npm run dev
```

Open:
- `http://localhost:3000/app`
- preview API: `POST http://localhost:3000/api/preview`
- carrier callback: `POST http://localhost:3000/carrier-service/rates`

## Deploy to Railway
1. Create a new Railway service from this folder.
2. Add variables from `.env.example`.
3. Set the start command to `npm run start`.
4. Set the build command to `npm run build`.
5. Deploy.

## Register the Shopify carrier service
Use the included script endpoint after deployment:

```bash
POST /admin/register-carrier-service
```

That endpoint uses Shopify's GraphQL `carrierServiceCreate` mutation to create a real-time callback to your Railway app. Shopify documents that a carrier service connects to your external shipping rate calculation system through a callback URL. citeturn514197search12turn514197search0

## Access control
The admin UI is designed for WidgetCo's approved operators only. Shopify embedded apps can identify the current admin user through session tokens / ID tokens, and this scaffold includes an allowlist layer on top. citeturn514197search4turn514197search1

## Suggested next implementation steps
1. Store exact per-variant weight in a Shopify metafield, such as `custom.true_weight_grams`.
2. Replace the demo catalog map in `src/services/catalog.ts` with a Shopify Admin API lookup or synced local table.
3. Wire FedEx live rating first, then UPS and USPS.
4. Replace the JSON file settings store with Postgres on Railway.
5. Add change logging for all settings edits.

## Example behavior
For an order of 25,000 units at 0.1 g each, this app calculates roughly 2,500 g of item weight before packaging instead of 0 g or 25,000 g. The returned rates are then based on the corrected shipment weight.


## Quick local start

1. Copy `.env.example` to `.env`.
2. Run `npm install`.
3. Run `npm run dev`.
4. Open `http://localhost:3000/app`.

This refreshed zip removes the email allowlist requirement for local use so the UI opens immediately.
