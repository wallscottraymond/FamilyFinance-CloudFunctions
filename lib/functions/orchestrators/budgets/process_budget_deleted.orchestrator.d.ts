/**
 * Process Budget Deleted (Cascade Job Handler)
 *
 * Runs asynchronously after a budget document is deleted. Performs:
 * 1. Deletes all budget periods for the budget.
 * 2. Reassigns transaction splits that referenced it to Everything Else.
 * 3. Releases the budget's categories back to Everything Else.
 *
 * @module orchestrators/budgets/process_budget_deleted
 */
import { TraceContext } from "../../types";
import { ProcessBudgetDeletedPayload } from "../../types/budgets/delete_budget.types";
/**
 * Processes the delete cascade.
 */
export declare function process_budget_deleted_orchestrator(ctx: TraceContext, payload: ProcessBudgetDeletedPayload): Promise<void>;
//# sourceMappingURL=process_budget_deleted.orchestrator.d.ts.map