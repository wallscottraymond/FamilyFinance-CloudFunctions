/**
 * Outflow Main Dev/Testing Functions Module
 *
 * Exports development and testing functions for outflow_main
 */

// Removed from prod 2026-09-22: createTestOutflows (onCall dev) did a full `outflow_periods WHERE
// userId` scan (~14.5K docs) — the top Firestore read line. Kept in source for local/emulator use;
// re-export + deploy only if deliberately needed for testing.
// export * from './createTestOutflows';
// Deleted from prod 2026-08-04 (deprecated dev/debug): simulatePlaidRecurring, debugOutflowPeriods, testOutflowUpdate
export {};
