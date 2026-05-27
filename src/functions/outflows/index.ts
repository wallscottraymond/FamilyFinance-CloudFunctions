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
// LEGACY TRIGGERS - DISABLED
// =============================================================================
// Using 5-layer architecture triggers instead (entry/triggers/)
// =============================================================================
// export * from './outflow_main/triggers/onOutflowCreated';  // Replaced by on_outflow_created
export * from './outflow_main/triggers/onOutflowUpdated';  // Keep until migrated

// Outflow period triggers (these are still used)
export * from './outflow_periods/triggers/onOutflowPeriodCreate';
export * from './outflow_periods/triggers/onOutflowPeriodUpdate';

// Type definitions from module-specific locations
export * from './outflow_main/types';
export * from './outflow_periods/types';

// Dev testing functions (emulator + production)
export * from './outflow_main/dev';
export * from './outflow_periods/dev';
export * from './outflow_summaries/dev';
