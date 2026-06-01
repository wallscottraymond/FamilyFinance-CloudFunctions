/**
 * Budget Trigger Functions Index
 *
 * ⚠️ DISABLED (2026-05): All legacy budget Firestore triggers have been
 * retired as part of the Budget CRUD Architecture Migration. They fired on any
 * write to the `budgets` / `budget_periods` collections — including writes made
 * by the new v2 layered-architecture orchestrators — which caused duplicate
 * period generation and cascade conflicts.
 *
 * Their responsibilities are now owned by the v2 cascade job handlers:
 *   - onBudgetCreate                      → process_budget_created.orchestrator
 *   - onBudgetUpdatedReassignTransactions → process_budget_updated.orchestrator
 *   - onBudgetUpdatedCascade              → process_budget_updated.orchestrator
 *   - onBudgetDelete                      → process_budget_deleted.orchestrator
 *   - onBudgetPeriodUpdated               → (note/checklist overlap sync — not
 *     yet ported; tracked as follow-up period-fidelity work)
 *
 * Removing these exports causes `firebase deploy` to delete the deployed
 * functions. The source files are retained for reference until the migration
 * is fully validated.
 *
 * Note: the legacy onBudgetDelete recreated the "Everything Else" system budget
 * if it was deleted. The v2 delete path instead BLOCKS deletion of that budget
 * in the domain layer (compute_delete_budget), so the safety net is no longer
 * required for app-driven deletes.
 */

// export { onBudgetCreate } from './onBudgetCreate';
// export { onBudgetDelete } from './onBudgetDelete';
// export { onBudgetUpdatedReassignTransactions } from './onBudgetUpdate';
// export { onBudgetUpdatedCascade } from './onBudgetUpdatedCascade';
// export { onBudgetPeriodUpdated } from './onBudgetPeriodUpdated';

export {};
