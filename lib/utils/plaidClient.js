"use strict";
/**
 * Plaid Client Configuration Utilities
 *
 * Handles Plaid API client creation and basic operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlaidClient = createPlaidClient;
exports.exchangePublicToken = exchangePublicToken;
const plaid_1 = require("plaid");
/**
 * Creates and configures a Plaid API client
 */
function createPlaidClient(clientId, secret) {
    try {
        console.log('Creating Plaid client for sandbox environment');
        const configuration = new plaid_1.Configuration({
            basePath: plaid_1.PlaidEnvironments.sandbox,
            baseOptions: {
                headers: {
                    'PLAID-CLIENT-ID': clientId,
                    'PLAID-SECRET': secret,
                },
            },
        });
        return new plaid_1.PlaidApi(configuration);
    }
    catch (error) {
        console.error('Failed to create Plaid client:', error);
        throw new Error(`Plaid client configuration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
/**
 * Exchanges a public token for an access token
 */
async function exchangePublicToken(plaidClient, publicToken) {
    try {
        console.log('Exchanging public token for access token...');
        const exchangeRequest = {
            public_token: publicToken,
        };
        const exchangeResponse = await plaidClient.itemPublicTokenExchange(exchangeRequest);
        const { access_token: accessToken, item_id: itemId } = exchangeResponse.data;
        console.log('Public token exchanged successfully', { itemId });
        return { accessToken, itemId };
    }
    catch (error) {
        console.error('Public token exchange failed:', error);
        throw new Error(`Token exchange failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
//# sourceMappingURL=plaidClient.js.map