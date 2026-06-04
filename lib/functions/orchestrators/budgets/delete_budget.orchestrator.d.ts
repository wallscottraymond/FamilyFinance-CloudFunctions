/**
 * Delete Budget Orchestrator
 *
 * Synchronous path for deleting a budget: idempotency → resolve → validate →
 * delete document → enqueue cascade. The cascade (period deletion, transaction
 * reassignment, category release) runs in process_budget_deleted.
 *
 * @module orchestrators/budgets/delete_budget
 */
import { TraceContext } from "../../types";
import { DeleteBudgetResponse } from "../../types/budgets/delete_budget.types";
/**
 * Deletes a budget.
 */
export declare function delete_budget_orchestrator(ctx: TraceContext, user_id: string, idempotency_key: string, budget_id: string): Promise<DeleteBudgetResponse>;
//# sourceMappingURL=delete_budget.orchestrator.d.ts.map