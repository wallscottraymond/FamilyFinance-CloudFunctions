/**
 * Update Budget Domain Service
 *
 * Pure, deterministic computation of an updated budget entity. Enforces
 * system-budget guardrails (the "Everything Else" budget allows name changes
 * only; its amount is computed, not set). NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/update_budget
 */
import { DomainResult } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
import { UpdateBudgetComputeInput } from "../../types/budgets/update_budget.types";
/**
 * Compute the updated budget entity from a partial update.
 *
 * PURE FUNCTION - clock is injected.
 *
 * @param compute - Identity, partial input, resolved deps, and clock
 * @returns The updated budget entity or validation errors
 */
export declare function compute_update_budget(compute: UpdateBudgetComputeInput): DomainResult<BudgetEntity>;
//# sourceMappingURL=update_budget.service.d.ts.map