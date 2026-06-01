/**
 * Update Budget Domain Service
 *
 * Pure, deterministic computation of an updated budget entity. Enforces
 * system-budget guardrails (the "Everything Else" budget allows name changes
 * only; its amount is computed, not set). NO async, NO IO, NO side effects.
 *
 * @module domain/budgets/update_budget
 */

import { Timestamp } from "firebase-admin/firestore";
import { DomainResult } from "../../types";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";
import {
  UpdateBudgetComputeInput,
  UpdateBudgetInput,
} from "../../types/budgets/update_budget.types";

/**
 * Compute the updated budget entity from a partial update.
 *
 * PURE FUNCTION - clock is injected.
 *
 * @param compute - Identity, partial input, resolved deps, and clock
 * @returns The updated budget entity or validation errors
 */
export function compute_update_budget(
  compute: UpdateBudgetComputeInput
): DomainResult<BudgetEntity> {
  const { user_id, input, dependencies, now } = compute;
  const existing = dependencies.existing;
  const validation_errors: string[] = [];

  if (!user_id) {
    validation_errors.push("user_id is required");
  }

  // System "Everything Else" budget: name changes only.
  if (existing.is_system_everything_else) {
    const non_name_change = describe_non_name_changes(input);
    if (non_name_change.length > 0) {
      validation_errors.push(
        "Only name can be changed on the 'Everything Else' budget. " +
          `Cannot edit: ${non_name_change.join(", ")}`
      );
    }
  }

  // Fixed end date validation
  let budget_end: Date | null = existing.budget_end_date
    ? existing.budget_end_date.toDate()
    : null;
  const next_is_ongoing =
    input.is_ongoing !== undefined ? input.is_ongoing : existing.is_ongoing;

  if (input.is_ongoing === false || (next_is_ongoing === false && input.budget_end_date)) {
    if (input.budget_end_date) {
      budget_end = parse_date(input.budget_end_date);
      if (!budget_end) {
        validation_errors.push("budget_end_date must be a valid date");
      } else if (budget_end <= existing.start_date.toDate()) {
        validation_errors.push("budget_end_date must be after start_date");
      }
    } else if (input.is_ongoing === false && !budget_end) {
      validation_errors.push(
        "budget_end_date is required when is_ongoing is false"
      );
    }
  }

  if (validation_errors.length > 0) {
    return { validation_errors };
  }

  const next_amount = input.amount !== undefined ? input.amount : existing.amount;
  const next_category_ids = input.category_ids ?? existing.category_ids;

  const entity: BudgetEntity = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() : existing.name,
    description:
      input.description !== undefined ? input.description : existing.description,
    amount: next_amount,
    category_ids: next_category_ids,
    // Invalidation-based: remaining is always recomputed from spent.
    remaining: next_amount - existing.spent,
    alert_threshold:
      input.alert_threshold !== undefined
        ? input.alert_threshold
        : existing.alert_threshold,
    is_ongoing: next_is_ongoing,
    budget_end_date:
      next_is_ongoing === false && budget_end
        ? Timestamp.fromDate(budget_end)
        : next_is_ongoing
          ? undefined
          : existing.budget_end_date,
    rollover_enabled:
      input.rollover_enabled !== undefined
        ? input.rollover_enabled
        : existing.rollover_enabled,
    rollover_strategy:
      input.rollover_strategy !== undefined
        ? input.rollover_strategy
        : existing.rollover_strategy,
    rollover_spread_periods:
      input.rollover_spread_periods !== undefined
        ? input.rollover_spread_periods
        : existing.rollover_spread_periods,
    updated_at: now,
  };

  return { entity };
}

/**
 * List the fields (other than name) that a partial update would change.
 * Used to reject disallowed edits on the system budget.
 *
 * PURE helper.
 */
function describe_non_name_changes(input: UpdateBudgetInput): string[] {
  const changed: string[] = [];
  if (input.amount !== undefined) changed.push("amount");
  if (input.category_ids !== undefined) changed.push("category_ids");
  if (input.description !== undefined) changed.push("description");
  if (input.alert_threshold !== undefined) changed.push("alert_threshold");
  if (input.is_ongoing !== undefined) changed.push("is_ongoing");
  if (input.budget_end_date !== undefined) changed.push("budget_end_date");
  if (input.rollover_enabled !== undefined) changed.push("rollover_enabled");
  if (input.rollover_strategy !== undefined) changed.push("rollover_strategy");
  if (input.rollover_spread_periods !== undefined) {
    changed.push("rollover_spread_periods");
  }
  return changed;
}

/**
 * Parse an ISO date string; returns null if invalid.
 *
 * PURE helper.
 */
function parse_date(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
