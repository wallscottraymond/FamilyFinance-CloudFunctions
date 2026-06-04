/**
 * Process Budget Created (Cascade Job Handler)
 *
 * Runs asynchronously after a budget is created. Performs the heavy work:
 * 1. Transfers claimed categories away from their previous owners.
 * 2. Generates budget periods from source periods.
 *
 * Reimplemented in the layered architecture (domain computes, repos persist) —
 * does not call the legacy category-transfer / period-generation utilities.
 *
 * @module orchestrators/budgets/process_budget_created
 */
import { TraceContext } from "../../types";
import { ProcessBudgetCreatedPayload } from "../../types/budgets/create_budget.types";
/**
 * Processes the create cascade.
 */
export declare function process_budget_created_orchestrator(ctx: TraceContext, payload: ProcessBudgetCreatedPayload): Promise<void>;
//# sourceMappingURL=process_budget_created.orchestrator.d.ts.map