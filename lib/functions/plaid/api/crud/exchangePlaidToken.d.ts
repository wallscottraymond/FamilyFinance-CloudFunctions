/**
 * Exchange Plaid Token Cloud Function
 *
 * Exchanges a public token for an access token using the Plaid API.
 * This function orchestrates the complete token exchange flow including:
 * - Public token → Access token exchange
 * - Account data retrieval and storage
 * - Recurring transaction processing
 * - Transaction conversion to Family Finance format
 *
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Encrypted access token storage (TODO: implement encryption)
 * - Proper error handling and validation
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled for mobile app
 */
/**
 * Main exchange Plaid token function
 */
export declare const exchangePlaidToken: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=exchangePlaidToken.d.ts.map