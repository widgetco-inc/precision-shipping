import dotenv from 'dotenv';
dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appBaseUrl: required('APP_BASE_URL', 'http://localhost:3000'),

  // Shopify
  shopifyShop: required('SHOPIFY_SHOP', 'widgetco-inc.myshopify.com'),
  shopifyStoreDomain: required('SHOPIFY_STORE_DOMAIN', 'widgetco.com'),
  shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? '',
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-10',
  shopifyCarrierServiceName: process.env.SHOPIFY_CARRIER_SERVICE_NAME ?? 'Precision Shipping',

  // Auth
  allowedAdminEmails: (process.env.ALLOWED_ADMIN_EMAILS ?? '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  localAdminLabel: process.env.LOCAL_ADMIN_LABEL ?? 'local-admin@widgetco.local',
  sessionTokenSecret: process.env.SESSION_TOKEN_SECRET ?? 'local-dev-secret',

  // FedEx
  fedexClientId:     process.env.FEDEX_CLIENT_ID ?? '',
  fedexClientSecret: process.env.FEDEX_CLIENT_SECRET ?? '',
  fedexAccountNumber: process.env.FEDEX_ACCOUNT_NUMBER ?? '',

  // UPS
  upsClientId:      process.env.UPS_CLIENT_ID ?? '',
  upsClientSecret:  process.env.UPS_CLIENT_SECRET ?? '',
  upsAccountNumber: process.env.UPS_ACCOUNT_NUMBER ?? '',

  // USPS
  uspsClientId:     process.env.USPS_CLIENT_ID ?? '',
  uspsClientSecret: process.env.USPS_CLIENT_SECRET ?? '',

  // Origin (your warehouse/ship-from address)
  originZip:     process.env.ORIGIN_ZIP ?? '',
  originCity:    process.env.ORIGIN_CITY ?? '',
  originState:   process.env.ORIGIN_STATE ?? '',
  originAddress: process.env.ORIGIN_ADDRESS ?? '',
  originName:    process.env.ORIGIN_NAME ?? 'WidgetCo',
};
