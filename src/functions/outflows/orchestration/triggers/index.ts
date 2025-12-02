/**
 * Outflows Firestore Triggers
 *
 * Exports all Firestore trigger functions for outflows
 *
 * NOTE: Summary update triggers have been moved to the centralized
 * Period-Centric Summary System at /functions/summaries/triggers/
 * Do NOT re-export them here to avoid duplicate trigger executions.
 *
 * NOTE: Trigger files have been moved to their respective module directories:
 * - onOutflowCreated → outflow_main/triggers/
 * - onOutflowUpdated → outflow_main/triggers/
 * - onOutflowPeriodCreate → outflow_periods/triggers/
 */

export * from '../../outflow_main/triggers/onOutflowCreated';
export * from '../../outflow_main/triggers/onOutflowUpdated';
export * from '../../outflow_periods/triggers/onOutflowPeriodCreate';

// OLD Summary Triggers - REMOVED (now in /functions/summaries/triggers/)
// Exported from centralized location to prevent duplicate trigger executions
// export * from '../summaryTriggers/onOutflowPeriodCreatedSummary';
// export * from '../summaryTriggers/onOutflowPeriodUpdatedSummary';
// export * from '../summaryTriggers/onOutflowPeriodDeletedSummary';
// export * from '../summaryTriggers/onOutflowUpdatedSummary';
