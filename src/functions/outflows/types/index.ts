/**
 * Outflows Types - Central Re-export Hub
 *
 * This file re-exports all outflow-related types from their respective module directories.
 * Types are now organized by domain:
 *
 * - outflow_main/types/ - Main outflow entity types
 * - outflow_periods/types/ - Outflow period types
 * - outflow_summaries/types/ - Summary-related types (future)
 *
 * ⚠️ IMPORTANT: Import from specific modules for better clarity:
 * ```typescript
 * // Preferred - explicit module imports
 * import { Outflow, OutflowStatus } from '../outflow_main/types';
 * import { OutflowPeriod, PaymentType } from '../outflow_periods/types';
 *
 * // Still works - backward compatible
 * import { Outflow, OutflowPeriod } from '../types';
 * ```
 */

// Re-export all types from outflow_main module
export * from '../outflow_main/types';

// Re-export all types from outflow_periods module
export * from '../outflow_periods/types';

// Re-export all types from outflow_summaries module (when available)
// export * from '../outflow_summaries/types';
