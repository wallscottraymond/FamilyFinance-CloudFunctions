/**
 * Outflows Functions Module
 *
 * Exports all outflow-related cloud functions organized by functionality
 */

// Public API functions from module-specific locations
export * from './outflow_main/crud/createManualOutflow';
export * from './outflow_periods/api';

// Background orchestration (triggers)
// NOTE: Trigger files are organized by module in their respective directories
export * from './outflow_main/triggers/onOutflowCreated';
export * from './outflow_main/triggers/onOutflowUpdated';
export * from './outflow_periods/triggers/onOutflowPeriodCreate';

// Type definitions from module-specific locations
export * from './outflow_main/types';
export * from './outflow_periods/types';

// Dev testing functions (emulator + production)
export * from './outflow_main/dev';
export * from './outflow_periods/dev';
