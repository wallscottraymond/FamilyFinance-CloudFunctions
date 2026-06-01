/**
 * Budget Domain Services
 *
 * Pure business logic for budget CRUD.
 * NO async, NO IO, NO side effects.
 *
 * @module domain/budgets
 */

export {
  PeriodInstanceType,
  PeriodAllocationInput,
  SourcePeriodForGeneration,
  ComputeBudgetPeriodsInput,
  count_days_inclusive,
  days_in_month,
  compute_period_allocation,
  compute_daily_rate,
  compute_budget_periods,
  budget_cadence_to_instance,
  compute_period_generation_end,
  ExistingPeriodForRealloc,
  PeriodAllocationUpdate,
  ReallocateBudgetPeriodsInput,
  compute_reallocated_periods,
} from "./period_generation.service";

export {
  CategoryTransfer,
  CategoryTransferPlan,
  compute_create_transfer_plan,
  compute_update_transfer_plan,
  compute_delete_transfer_plan,
} from "./category_ownership.service";

export { compute_create_budget } from "./create_budget.service";
export { compute_update_budget } from "./update_budget.service";
export { compute_delete_budget } from "./delete_budget.service";
