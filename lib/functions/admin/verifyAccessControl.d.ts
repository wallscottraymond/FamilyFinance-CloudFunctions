/**
 * Access Control Verification Script
 *
 * This admin function verifies that the 3-step access control pattern
 * is correctly implemented across all document types:
 * 1. Build complete structure with defaults
 * 2. Enhance with calculated group sharing
 * 3. Merge and save to Firestore (single write)
 *
 * Tests:
 * - Transactions
 * - Accounts
 * - Budgets
 * - Outflows
 * - Outflow Periods
 * - Inflow Periods
 */
/**
 * Main verification function
 */
export declare const verifyAccessControl: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=verifyAccessControl.d.ts.map