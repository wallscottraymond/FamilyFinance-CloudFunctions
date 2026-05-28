/**
 * Outflows Functions Module
 *
 * Exports all outflow-related cloud functions organized by functionality
 *
 * ARCHITECTURE MIGRATION (2026-05-26):
 * - Legacy triggers (onOutflowCreated, onOutflowUpdated) are DEPRECATED
 * - New triggers are in entry/triggers/ and follow 5-layer architecture
 * - See entry/triggers/on_outflow_created.trigger.ts for the refactored version
 */

// Public API functions from module-specific locations
export * from './outflow_main/crud/createManualOutflow';
export * from './outflow_periods/api';

// =============================================================================
// LEGACY TRIGGERS - ALL DISABLED
// =============================================================================
// Using 5-layer architecture triggers instead (entry/triggers/)
// =============================================================================
// export * from './outflow_main/triggers/onOutflowCreated';  // Replaced by on_outflow_created
// export * from './outflow_main/triggers/onOutflowUpdated';  // DISABLED - causes cascade via runUpdateOutflowPeriods

// =============================================================================
// OUTFLOW PERIOD TRIGGERS - ALL DISABLED TO MATCH INFLOW PATTERN
// =============================================================================
// BOTH onOutflowPeriodCreate AND onOutflowPeriodUpdate triggers are disabled
// because they cause race conditions:
//
// The cascade problem:
// 1. onOutflowPeriodCreate fires for each of 50+ periods created
// 2. It runs matchAllTransactionsToOccurrences() which UPDATES each period
// 3. Each UPDATE triggers on_outflow_period_updated_summary
// 4. All those jobs run concurrently and overwrite each other
//
// Similarly:
// 1. onOutflowPeriodUpdate fires when periods are updated
// 2. It also runs matchAllTransactionsToOccurrences() which UPDATES the period
// 3. This triggers on_outflow_period_updated_summary AGAIN
// 4. Creating another race condition
//
// Inflows work because they have NO equivalent triggers.
// Summary updates are handled by the orchestrator AFTER all periods are created.
// Manual period updates are handled differently (not via these triggers).
// =============================================================================
// export * from './outflow_periods/triggers/onOutflowPeriodCreate';  // DISABLED - causes race conditions
// export * from './outflow_periods/triggers/onOutflowPeriodUpdate';  // DISABLED - causes race conditions

// Type definitions from module-specific locations
export * from './outflow_main/types';
export * from './outflow_periods/types';

// Dev testing functions (emulator + production)
export * from './outflow_main/dev';
export * from './outflow_periods/dev';
export * from './outflow_summaries/dev';
