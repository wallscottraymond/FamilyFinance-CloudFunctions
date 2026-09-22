/**
 * Outflow Periods Dev/Testing Functions Module
 *
 * Exports development and testing functions for outflow_periods
 */

// Removed from prod 2026-09-22: extendOutflowPeriods (unauthenticated onRequest that WROTE data)
// replaced by the system-only scheduled `extendRecurringOutflowPeriods` (../scheduled/). Logic is
// shared via createOutflowPeriodsFromSource; file kept for reference / emulator use.
// export * from './extendOutflowPeriods';
// Deleted from prod 2026-08-04 (deprecated migration/debug): migrateOutflowPeriodsTransactionSplits, debugTransactionMatching
export {};
