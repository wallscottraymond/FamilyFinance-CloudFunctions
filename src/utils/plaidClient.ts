/**
 * Plaid Client Configuration Utilities
 * 
 * Handles Plaid API client creation and basic operations
 */

import { PlaidApi, Configuration, PlaidEnvironments } from 'plaid';

/**
 * Creates and configures a Plaid API client
 */
export function createPlaidClient(clientId: string, secret: string): PlaidApi {
  try {
    console.log('Creating Plaid client for sandbox environment');
    
    const configuration = new Configuration({
      basePath: PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': clientId,
          'PLAID-SECRET': secret,
        },
      },
    });

    return new PlaidApi(configuration);
  } catch (error) {
    console.error('Failed to create Plaid client:', error);
    throw new Error(`Plaid client configuration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Exchanges a public token for an access token
 */
export async function exchangePublicToken(
  plaidClient: PlaidApi,
  publicToken: string
): Promise<{ accessToken: string; itemId: string }> {
  try {
    console.log('Exchanging public token for access token...');
    
    const exchangeRequest = {
      public_token: publicToken,
    };

    const exchangeResponse = await plaidClient.itemPublicTokenExchange(exchangeRequest);
    const { access_token: accessToken, item_id: itemId } = exchangeResponse.data;

    console.log('Public token exchanged successfully', { itemId });
    
    return { accessToken, itemId };
  } catch (error) {
    console.error('Public token exchange failed:', error);
    throw new Error(`Token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}