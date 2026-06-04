"use strict";
/**
 * Budget Trigger Functions Index
 *
 * ⚠️ RETIRED (2026-06): All legacy budget Firestore triggers were deleted as
 * part of the Budget CRUD Architecture Migration. They fired on any write to
 * `budgets` / `budget_periods` — including the new v2 orchestrators' writes —
 * causing duplicate period generation and cascade conflicts.
 *
 * Their responsibilities are now owned by the v2 cascade job handlers
 * (orchestrators/budgets/process_budget_{created,updated,deleted}):
 *   - onBudgetCreate                      → process_budget_created
 *   - onBudgetUpdatedReassignTransactions → process_budget_updated (category transfer)
 *   - onBudgetUpdatedCascade              → process_budget_updated (amount reallocation + rename)
 *     NOTE: budget-level isActive pause/resume (redistribute to Everything Else)
 *     was NOT ported — see git history if that behavior is reintroduced.
 *   - onBudgetDelete                      → process_budget_deleted. The legacy
 *     EE auto-recreation was dropped; v2 BLOCKS Everything-Else deletion in the
 *     domain layer (compute_delete_budget) instead.
 *   - onBudgetPeriodUpdated               → note/checklist overlap sync, still
 *     PENDING (#2). Core logic remains in utils/syncNotesToOverlappingPeriods.
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=index.js.map