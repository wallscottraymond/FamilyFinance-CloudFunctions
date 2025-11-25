/**
 * Create Plaid Link Token Cloud Function
 *
 * Generates a link token required for Plaid Link initialization.
 * This function creates a secure token that allows the mobile app
 * to connect bank accounts through Plaid's Link flow.
 *
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - User-specific token generation with client_user_id
 * - Secure product and environment configuration
 * - Error handling and validation
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled for mobile app
 * Promise Pattern: ✓
 */
/**
 * Create Plaid Link Token
 */
export declare const createLinkToken: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=createLinkToken.d.ts.map