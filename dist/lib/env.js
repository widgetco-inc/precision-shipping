"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function required(name, fallback) {
    const value = process.env[name] ?? fallback;
    if (!value)
        throw new Error(`Missing required env var: ${name}`);
    return value;
}
exports.env = {
    port: Number(process.env.PORT ?? 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    appBaseUrl: required('APP_BASE_URL', 'http://localhost:3000'),
    shopifyShop: required('SHOPIFY_SHOP', 'widgetco-inc.myshopify.com'),
    shopifyStoreDomain: required('SHOPIFY_STORE_DOMAIN', 'widgetco.com'),
    shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? '',
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? '2025-10',
    shopifyCarrierServiceName: process.env.SHOPIFY_CARRIER_SERVICE_NAME ?? 'WidgetCo Precision Shipping',
    allowedAdminEmails: (process.env.ALLOWED_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    localAdminLabel: process.env.LOCAL_ADMIN_LABEL ?? 'local-admin@widgetco.local',
    sessionTokenSecret: process.env.SESSION_TOKEN_SECRET ?? 'local-dev-secret',
    fedexAccountNumber: process.env.FEDEX_ACCOUNT_NUMBER ?? '',
    fedexApiKey: process.env.FEDEX_API_KEY ?? '',
    fedexApiSecret: process.env.FEDEX_API_SECRET ?? ''
};
