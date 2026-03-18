"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shopifyGraphql = shopifyGraphql;
exports.registerCarrierService = registerCarrierService;
const env_1 = require("./lib/env");
async function shopifyGraphql(query, variables) {
    if (!env_1.env.shopifyAdminAccessToken) {
        throw new Error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN');
    }
    const response = await fetch(`https://${env_1.env.shopifyShop}/admin/api/${env_1.env.shopifyApiVersion}/graphql.json`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': env_1.env.shopifyAdminAccessToken
        },
        body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Shopify GraphQL failed: ${response.status} ${text}`);
    }
    return response.json();
}
async function registerCarrierService() {
    const mutation = `
    mutation carrierServiceCreate($input: DeliveryCarrierServiceCreateInput!) {
      carrierServiceCreate(input: $input) {
        carrierService {
          id
          active
          callbackUrl
          formattedName
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
    const variables = {
        input: {
            active: true,
            callbackUrl: `${env_1.env.appBaseUrl}/carrier-service/rates`,
            name: env_1.env.shopifyCarrierServiceName,
            supportsServiceDiscovery: true
        }
    };
    return shopifyGraphql(mutation, variables);
}
