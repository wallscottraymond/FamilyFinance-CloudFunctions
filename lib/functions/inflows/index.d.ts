/**
 * Inflows Module - Cloud Functions
 *
 * This module provides inflow (recurring income) management for the Family Finance app,
 * including automatic inflow period generation, transaction alignment, and prediction.
 *
 * Functions included:
 * - onInflowCreated: Automatic inflow period generation trigger
 * - onInflowUpdated: Cascade inflow changes to periods trigger
 *
 * Architecture:
 * - orchestration/triggers: Firestore triggers (Inflow period generation/updates)
 * - inflow_periods/utils: Utilities for period management, alignment, prediction
 */
export { onInflowCreated } from "./orchestration/triggers/onInflowCreated";
export { onInflowUpdated } from "./orchestration/triggers/onInflowUpdated";
export { alignTransactionsToInflowPeriods, matchTransactionToInflowPeriod, predictNextPayment, predictPaymentsInPeriod, calculateInflowPeriodStatus, runUpdateInflowPeriods, AlignmentResult, PaymentPrediction, InflowPeriodStatus, InflowUpdateResult } from "./inflow_periods/utils";
/**
 * Function Overview:
 *
 * onInflowCreated:
 * - Purpose: Automatically generate inflow_periods when inflow is created
 * - Also: Aligns historical transactions and calculates predictions
 * - Triggers: When document created in inflows collection
 * - Memory: 512MiB, Timeout: 60s
 * - Location: orchestration/triggers/onInflowCreated.ts
 *
 * onInflowUpdated:
 * - Purpose: Cascade inflow changes to all related inflow_periods
 * - Handles: averageAmount, userCustomName, transactionIds changes
 * - Triggers: When document updated in inflows collection
 * - Memory: 512MiB, Timeout: 60s
 * - Location: orchestration/triggers/onInflowUpdated.ts
 */
//# sourceMappingURL=index.d.ts.map