/**
 * Create Budget Domain Service
 *
 * Pure, deterministic computation of a new budget entity from normalized input
 * and resolved dependencies. Enforces business rules (budget limit, end-date
 * validity). NO async, NO IO, NO side effects, NO logging.
 *
 * @module domain/budgets/create_budget
 */
import { DomainResult } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
import { CreateBudgetComputeInput } from "../../types/budgets/create_budget.types";
/**
 * Compute a new budget entity.
 *
 * PURE FUNCTION - all non-determinism (id, now) is injected.
 *
 * @param compute - Identity, normalized input, resolved deps, and clock
 * @returns The budget entity or validation errors
 */
export declare function compute_create_budget(compute: CreateBudgetComputeInput): DomainResult<BudgetEntity>;
//# sourceMappingURL=create_budget.service.d.ts.map