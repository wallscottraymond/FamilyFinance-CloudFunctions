/**
 * Delete Budget Domain Service
 *
 * Pure, deterministic validation and planning for a budget deletion. Decides
 * whether the delete is allowed and what cascade work must be scheduled.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/delete_budget
 */
import { DomainResult } from "../../types";
import { DeleteBudgetComputeInput, DeleteBudgetPlan } from "../../types/budgets/delete_budget.types";
/**
 * Compute the delete plan for a budget.
 *
 * PURE FUNCTION.
 *
 * @param compute - Identity, resolved deps, and clock
 * @returns The delete plan or validation errors
 */
export declare function compute_delete_budget(compute: DeleteBudgetComputeInput): DomainResult<DeleteBudgetPlan>;
//# sourceMappingURL=delete_budget.service.d.ts.map