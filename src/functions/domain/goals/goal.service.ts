/**
 * Goal Domain Service — Goals (Phase 1)
 *
 * PURE business logic for goals: input validation, per-period cadence
 * translation, and per-period measurement math. No IO, no Timestamps read from
 * the clock — everything is a function of its inputs (deterministic, unit-testable).
 *
 * Measurement is BALANCE-based (per the locked design): the resolver reads
 * balance snapshots + runs the partition allocation, then hands this service the
 * already-attributed numbers to shape into a GoalMeasurement.
 *
 * @module domain/goals/goal
 */

import { Timestamp } from "firebase-admin/firestore";
import { DomainResult, success, validation_failed } from "../../types/domain";
import {
  GoalType,
  GoalCadence,
  GoalMeasurement,
  GoalEntity,
} from "../../types/goals/goal_entity.types";
import {
  CreateGoalInput,
  UpdateGoalInput,
} from "../../types/goals/goal_crud.types";

/** Nominal days per cadence, used to translate a set-aside across cadences. */
const CADENCE_DAYS: Record<GoalCadence, number> = {
  weekly: 7,
  bi_monthly: 365 / 24, // ~15.21 — two periods per month
  monthly: 365 / 12, // ~30.44
};

const GOAL_TYPES: GoalType[] = [
  "debt_paydown",
  "big_purchase",
  "savings",
  "invest",
];

/** Validated shape for creating a goal (already normalized by the entry layer). */
export interface ValidateGoalInput {
  goal_type: GoalType;
  name: string;
  linked_account_id: string;
  target_amount?: number | null;
  home_cadence: GoalCadence;
  per_period_amount: number;
  baseline_counts_existing: boolean;
  // debt-only
  apr?: number | null;
  minimum_payment?: number | null;
  extra_principal?: number | null;
}

/**
 * Validate a goal-creation request. Returns the (unchanged) input on success or
 * a list of human-readable errors. PURE.
 */
export function validate_create_goal(
  input: ValidateGoalInput
): DomainResult<ValidateGoalInput> {
  const errors: string[] = [];

  if (!GOAL_TYPES.includes(input.goal_type)) {
    errors.push(`Invalid goal_type: ${input.goal_type}`);
  }
  if (!input.name || input.name.trim().length === 0) {
    errors.push("name is required");
  }
  if (!input.linked_account_id) {
    errors.push("linked_account_id is required");
  }
  if (!(input.per_period_amount > 0)) {
    errors.push("per_period_amount must be positive");
  }

  // Ongoing (savings/invest) may omit a target; purchase/debt need one.
  const requires_target =
    input.goal_type === "big_purchase" || input.goal_type === "debt_paydown";
  if (requires_target) {
    if (input.target_amount == null || !(input.target_amount > 0)) {
      errors.push(`${input.goal_type} requires a positive target_amount`);
    }
  }

  // Debt manual fields, when provided, must be sane (fallback when Plaid didn't enrich).
  if (input.apr != null && (input.apr < 0 || input.apr > 100)) {
    errors.push("apr must be between 0 and 100");
  }
  if (input.minimum_payment != null && input.minimum_payment < 0) {
    errors.push("minimum_payment cannot be negative");
  }
  if (input.extra_principal != null && input.extra_principal < 0) {
    errors.push("extra_principal cannot be negative");
  }

  return errors.length > 0 ? validation_failed(errors) : success(input);
}

/**
 * Assemble a new GoalEntity from a validated create input + resolver-supplied
 * dependencies (baseline balance, next priority rank) + injected clock. PURE.
 */
export function compute_create_goal(params: {
  goal_id: string;
  user_id: string;
  input: CreateGoalInput;
  baseline_balance: number;
  priority_rank: number;
  now: Timestamp;
}): DomainResult<GoalEntity> {
  const { input } = params;

  const validation = validate_create_goal({
    goal_type: input.goal_type,
    name: input.name,
    linked_account_id: input.linked_account_id,
    target_amount: input.target_amount,
    home_cadence: input.home_cadence,
    per_period_amount: input.per_period_amount,
    baseline_counts_existing: input.baseline_counts_existing,
    apr: input.apr,
    minimum_payment: input.minimum_payment,
    extra_principal: input.extra_principal,
  });
  if (validation.validation_errors) {
    return validation_failed(validation.validation_errors);
  }

  const group_ids = input.is_shared && input.group_id ? [input.group_id] : [];
  const is_private = group_ids.length === 0;

  const entity: GoalEntity = {
    id: params.goal_id,
    user_id: params.user_id,
    group_ids,
    is_active: true,
    access: {
      owner_id: params.user_id,
      created_by: params.user_id,
      group_ids,
      is_private,
    },
    created_by: params.user_id,
    owner_id: params.user_id,
    is_private,
    goal_type: input.goal_type,
    name: input.name.trim(),
    status: "active",
    linked_account_id: input.linked_account_id,
    target_amount: input.target_amount ?? null,
    end_date: input.end_date ? Timestamp.fromDate(new Date(input.end_date)) : null,
    home_cadence: input.home_cadence,
    per_period_amount: input.per_period_amount,
    baseline_balance: params.baseline_balance,
    baseline_counts_existing: input.baseline_counts_existing,
    priority_rank: params.priority_rank,
    draws_income: true, // locked default
    linked_recurring_id: input.linked_recurring_id ?? null,
    apr: input.apr ?? null,
    minimum_payment: input.minimum_payment ?? null,
    extra_principal: input.extra_principal ?? null,
    created_at: params.now,
    updated_at: params.now,
  };

  return success(entity);
}

/**
 * Merge an update patch onto an existing goal → the full updated entity. PURE.
 * `undefined` leaves a field unchanged; `null` clears a nullable field.
 */
export function compute_update_goal(params: {
  existing: GoalEntity;
  input: UpdateGoalInput;
  now: Timestamp;
}): DomainResult<GoalEntity> {
  const { existing, input } = params;
  const errors: string[] = [];

  if (input.name !== undefined && input.name.trim().length === 0) {
    errors.push("name cannot be empty");
  }
  if (input.per_period_amount !== undefined && !(input.per_period_amount > 0)) {
    errors.push("per_period_amount must be positive");
  }
  if (
    input.target_amount !== undefined &&
    input.target_amount !== null &&
    !(input.target_amount > 0)
  ) {
    errors.push("target_amount must be positive");
  }
  if (errors.length > 0) return validation_failed(errors);

  const pick = <T>(next: T | undefined, prev: T): T =>
    next === undefined ? prev : next;

  const updated: GoalEntity = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() : existing.name,
    target_amount: pick(input.target_amount, existing.target_amount ?? null),
    end_date:
      input.end_date === undefined
        ? existing.end_date ?? null
        : input.end_date === null
          ? null
          : Timestamp.fromDate(new Date(input.end_date)),
    home_cadence: pick(input.home_cadence, existing.home_cadence),
    per_period_amount: pick(input.per_period_amount, existing.per_period_amount),
    priority_rank: pick(input.priority_rank, existing.priority_rank),
    status: pick(input.status, existing.status),
    linked_recurring_id: pick(
      input.linked_recurring_id,
      existing.linked_recurring_id ?? null
    ),
    apr: pick(input.apr, existing.apr ?? null),
    minimum_payment: pick(input.minimum_payment, existing.minimum_payment ?? null),
    extra_principal: pick(input.extra_principal, existing.extra_principal ?? null),
    updated_at: params.now,
  };

  return success(updated);
}

/**
 * Daily set-aside rate implied by a per-period amount in a given home cadence.
 * PURE. e.g. $304.40/month → ~$10/day.
 */
export function goal_daily_rate(
  per_period_amount: number,
  home_cadence: GoalCadence
): number {
  return per_period_amount / CADENCE_DAYS[home_cadence];
}

/**
 * Translate a goal's per-period set-aside into the amount expected for a viewed
 * period spanning `span_days` days (the viewer's cadence). PURE.
 *
 * Prefer passing the viewed period's ACTUAL day span (from its source period) so
 * month-length variation is exact; callers without it can pass CADENCE_DAYS.
 */
export function amount_for_span(
  per_period_amount: number,
  home_cadence: GoalCadence,
  span_days: number
): number {
  const daily = goal_daily_rate(per_period_amount, home_cadence);
  return round2(daily * span_days);
}

/** Nominal day length of a cadence (for callers without a concrete period span). */
export function cadence_days(cadence: GoalCadence): number {
  return CADENCE_DAYS[cadence];
}

/**
 * Shape a GoalMeasurement from already-resolved inputs. PURE.
 *
 * @param params.goal_type            drives debt (balance-drop) vs save (balance-growth) sign
 * @param params.target_for_period    expected set-aside this period (from amount_for_span)
 * @param params.attributed_progress  net progress attributed to THIS goal this period
 *                                     (post-partition; already signed so positive = good)
 * @param params.cumulative_progress  signed cumulative progress toward target (baseline-relative)
 * @param params.target_amount        goal target (null = ongoing)
 * @param params.data_incomplete      a needed snapshot was missing/stale
 */
export function compute_goal_measurement(params: {
  goal_id: string;
  period_id: string;
  target_for_period: number;
  attributed_progress: number;
  cumulative_progress: number;
  target_amount?: number | null;
  data_incomplete: boolean;
}): GoalMeasurement {
  const progress = round2(params.attributed_progress);
  const cumulative = round2(params.cumulative_progress);
  const target_reached =
    params.target_amount != null && cumulative >= params.target_amount;

  // Ongoing goals "meet" a period when progress ≥ the period's target set-aside.
  // Zero/negative target set-asides can't be "missed".
  const met =
    params.target_for_period <= 0 || progress >= params.target_for_period;

  return {
    goal_id: params.goal_id,
    period_id: params.period_id,
    target_for_period: round2(params.target_for_period),
    progress_for_period: progress,
    cumulative_progress: cumulative,
    met,
    target_reached,
    data_incomplete: params.data_incomplete,
  };
}

/** Round to 2 decimal places (currency). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
