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
export * from './outflow_main/crud/createManualOutflow';
export * from './outflow_periods/api';
export * from './outflow_main/types';
export * from './outflow_periods/types';
export * from './outflow_main/dev';
export * from './outflow_periods/dev';
export * from './outflow_summaries/dev';
//# sourceMappingURL=index.d.ts.map