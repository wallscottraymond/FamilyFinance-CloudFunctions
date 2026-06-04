/**
 * Update Budget Orchestrator
 *
 * Synchronous path for updating a budget: idempotency → resolve → compute →
 * persist → enqueue cascade. Category transfer and period regeneration are
 * deferred to the process_budget_updated job.
 *
 * @module orchestrators/budgets/update_budget
 */
import { TraceContext } from "../../types";
import { UpdateBudgetInput, UpdateBudgetResponse } from "../../types/budgets/update_budget.types";
/**
 * Updates a budget.
 */
export declare function update_budget_orchestrator(ctx: TraceContext, user_id: string, idempotency_key: string, input: UpdateBudgetInput): Promise<UpdateBudgetResponse>;
//# sourceMappingURL=update_budget.orchestrator.d.ts.map