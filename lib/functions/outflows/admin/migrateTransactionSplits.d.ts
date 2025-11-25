/**
 * Migration Script: Add transactionSplits field to existing outflow_periods
 *
 * This admin function updates all existing outflow_periods documents to include
 * the new transactionSplits field initialized as an empty array.
 *
 * Usage: Call via HTTPS endpoint
 * https://us-central1-{project}.cloudfunctions.net/migrateOutflowPeriodsTransactionSplits
 */
export declare const migrateOutflowPeriodsTransactionSplits: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=migrateTransactionSplits.d.ts.map