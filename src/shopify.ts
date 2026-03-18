import { env } from './lib/env';

export async function shopifyGraphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!env.shopifyAdminAccessToken) {
    throw new Error('Missing SHOPIFY_ADMIN_ACCESS_TOKEN');
  }

  const response = await fetch(`https://${env.shopifyShop}/admin/api/${env.shopifyApiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': env.shopifyAdminAccessToken
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify GraphQL failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<T>;
}

export async function registerCarrierService(): Promise<unknown> {
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
      callbackUrl: `${env.appBaseUrl}/carrier-service/rates`,
      name: env.shopifyCarrierServiceName,
      supportsServiceDiscovery: true
    }
  };

  return shopifyGraphql(mutation, variables);
}
