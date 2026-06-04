/**
 * Process Budget Updated (Cascade Job Handler)
 *
 * Runs asynchronously after a budget is updated. Performs:
 * 1. Category claims (added) — remove from prior owners.
 * 2. Category releases (removed) — return to Everything Else.
 * 3. Re-allocates existing periods IN PLACE when the amount changed (preserving
 *    per-period user data: notes, checklist, modified amounts, and historical
 *    periods).
 *
 * @module orchestrators/budgets/process_budget_updated
 */
import { TraceContext } from "../../types";
import { ProcessBudgetUpdatedPayload } from "../../types/budgets/update_budget.types";
/**
 * Processes the update cascade.
 */
export declare function process_budget_updated_orchestrator(ctx: TraceContext, payload: ProcessBudgetUpdatedPayload): Promise<void>;
//# sourceMappingURL=process_budget_updated.orchestrator.d.ts.map