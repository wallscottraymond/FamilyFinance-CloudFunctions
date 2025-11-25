/**
 * Plaid Client Configuration Utilities
 *
 * Handles Plaid API client creation and basic operations
 */
import { PlaidApi } from 'plaid';
/**
 * Creates and configures a Plaid API client
 */
export declare function createPlaidClient(clientId: string, secret: string): PlaidApi;
/**
 * Exchanges a public token for an access token
 */
export declare function exchangePublicToken(plaidClient: PlaidApi, publicToken: string): Promise<{
    accessToken: string;
    itemId: string;
}>;
//# sourceMappingURL=plaidClient.d.ts.map