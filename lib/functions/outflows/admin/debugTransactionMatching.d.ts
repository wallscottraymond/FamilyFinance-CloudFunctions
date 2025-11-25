/**
 * Debug Transaction Matching - Admin Function
 *
 * Helps debug why transactions aren't being matched to outflow periods.
 * Checks:
 * - What transaction IDs are stored in the outflow
 * - Whether those documents exist in the transactions collection
 * - What the actual document IDs are
 *
 * Usage: GET /debugTransactionMatching?outflowId=OUTFLOW_ID
 */
export declare const debugTransactionMatching: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=debugTransactionMatching.d.ts.map