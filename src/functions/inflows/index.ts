/**
 * Inflows Module - Cloud Functions
 *
 * This module provides inflow (recurring income) management for the Family Finance app,
 * including automatic inflow period generation, transaction alignment, and prediction.
 *
 * Functions included:
 * - onInflowCreated: Automatic inflow period generation trigger
 * - onInflowUpdated: Cascade inflow changes to periods trigger
 * - extendRecurringInflowPeriods: Scheduled monthly maintenance (1st at 2:00 AM UTC)
 *
 * Architecture:
 * - orchestration/triggers: Firestore triggers (Inflow period generation/updates)
 * - orchestration/scheduled: Scheduled functions (rolling window maintenance)
 * - inflow_periods/utils: Utilities for period management, alignment, prediction
 */

// ===== Orchestration Functions =====

// Triggers
export { onInflowCreated } from "./orchestration/triggers/onInflowCreated";
export { onInflowUpdated } from "./orchestration/triggers/onInflowUpdated";

// Scheduled
export { extendRecurringInflowPeriods } from "./orchestration/scheduled/extendRecurringInflowPeriods";

// API Functions
export { regenerateInflowPeriods } from "./inflow_periods/api/regenerateInflowPeriods";
export { adminRegenerateInflowPeriods } from "./inflow_periods/api/adminRegenerateInflowPeriods";
export { updateInflowConfiguration } from "./inflow_periods/api/updateInflowConfiguration";
export { createManualInflow } from "./inflow_periods/api/createManualInflow";

// ===== Inflow Period Utilities =====
export {
  alignTransactionsToInflowPeriods,
  matchTransactionToInflowPeriod,
  predictNextPayment,
  predictPaymentsInPeriod,
  calculateInflowPeriodStatus,
  runUpdateInflowPeriods,
  AlignmentResult,
  PaymentPrediction,
  InflowPeriodStatus,
  InflowUpdateResult
} from "./inflow_periods/utils";

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
 *
 * extendRecurringInflowPeriods:
 * - Purpose: Maintain rolling 1-year window of inflow periods
 * - Schedule: Monthly on 1st at 2:00 AM UTC (matches budget maintenance)
 * - Memory: 512MiB, Timeout: 300s
 * - Location: orchestration/scheduled/extendRecurringInflowPeriods.ts
 */
