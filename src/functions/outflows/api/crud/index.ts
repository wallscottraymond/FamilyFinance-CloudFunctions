/**
 * Outflows CRUD Operations
 *
 * Exports all Create, Read, Update, Delete operations for outflows
 *
 * NOTE: Functions have been moved to their respective module directories:
 * - createManualOutflow → outflow_main/crud/
 */

// Re-export from outflow_main module
export * from '../../outflow_main/crud/createManualOutflow';

// Backward compatibility alias - deprecated, use createManualOutflow instead
export { createManualOutflow as createRecurringOutflow } from '../../outflow_main/crud/createManualOutflow';
