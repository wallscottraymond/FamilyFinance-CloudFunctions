/**
 * Outflow Summaries CRUD Operations
 *
 * Delete keeps the `outflow_summary` collection in sync on period deletion. The create/update/batch
 * helpers were deleted (they wrote the retired `user_summaries` + had no callers — Derive-Everywhere).
 */

export * from './deleteOutflowPeriodSummary';
