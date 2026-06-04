/**
 * Create Budget Orchestrator
 *
 * Synchronous path for creating a budget: idempotency → resolve → compute →
 * persist → enqueue cascade. Heavy work (category transfer, period generation)
 * is deferred to the process_budget_created job.
 *
 * @module orchestrators/budgets/create_budget
 */
import { TraceContext } from "../../types";
import { CreateBudgetInput, CreateBudgetResponse } from "../../types/budgets/create_budget.types";
/**
 * Creates a budget.
 *
 * @param ctx - Trace context
 * @param user_id - User creating the budget
 * @param idempotency_key - Client idempotency key
 * @param input - Normalized create input
 */
export declare function create_budget_orchestrator(ctx: TraceContext, user_id: string, idempotency_key: string, input: CreateBudgetInput): Promise<CreateBudgetResponse>;
//# sourceMappingURL=create_budget.orchestrator.d.ts.map