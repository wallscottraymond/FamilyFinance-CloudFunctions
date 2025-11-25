/**
 * Mock Exchange Plaid Token Cloud Function
 *
 * Temporary mock implementation for exchanging public tokens for access tokens.
 * This provides a working endpoint for testing the complete Plaid Link flow
 * without requiring real Plaid API integration.
 *
 * Security Features:
 * - User authentication required (VIEWER role minimum)
 * - Mock data generation following Plaid patterns
 * - Proper error handling and validation
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled for mobile app
 * Promise Pattern: ✓
 */
/**
 * Mock Exchange Plaid Token
 */
export declare const exchangePlaidToken: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=exchangePlaidTokenMock.d.ts.map