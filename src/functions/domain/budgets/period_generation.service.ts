/**
 * Budget Period Generation Domain Service
 *
 * Pure, deterministic logic for converting a budget amount into a per-period
 * allocation and daily rate. Ported from the legacy
 * `calculatePeriodAllocatedAmount` util with all IO and logging removed.
 *
 * NO async, NO IO, NO side effects, NO logging.
 *
 * @module domain/budgets/period_generation
 */

import { Timestamp } from "firebase-admin/firestore";
import { DomainResult } from "../../types";
import {
  BudgetPeriodEntity,
  BudgetPeriodType,
} from "../../types/budgets/budget_entity.types";

/**
 * Period instance cadence (the types the user interacts with daily).
 * Mirrors the legacy `PeriodType` enum string values.
 */
export type PeriodInstanceType = "weekly" | "monthly" | "bi_monthly";

/**
 * Maps a budget's cadence to the allocation base. Source periods only come in
 * weekly / monthly / bi_monthly, so quarterly/yearly/custom budgets allocate on
 * a monthly base (matching the legacy fallback).
 */
export function budget_cadence_to_instance(
  period: BudgetPeriodType
): "weekly" | "monthly" {
  return period === "weekly" ? "weekly" : "monthly";
}

/** Months of budget periods generated ahead for ongoing/recurring budgets. */
const GENERATION_HORIZON_MONTHS = 12;

/**
 * Compute the END of the period-generation window (the horizon up to which
 * budget periods are created).
 *
 * Mirrors the legacy `determineBudgetPeriodDateRange`:
 * - Ongoing/recurring → start + 12 months (the rolling scheduled job extends it).
 * - Limited (not ongoing) → the fixed `budget_end_date`, or +12 months if absent.
 *
 * NOTE: this is the generation HORIZON, distinct from the budget's nominal
 * `end_date` (which is one period long for legacy compatibility).
 *
 * PURE FUNCTION.
 */
export function compute_period_generation_end(
  start: Date,
  is_ongoing: boolean,
  budget_end_date: Date | null
): Date {
  if (!is_ongoing && budget_end_date) {
    return budget_end_date;
  }
  const end = new Date(start.getTime());
  end.setUTCMonth(end.getUTCMonth() + GENERATION_HORIZON_MONTHS);
  return end;
}

/**
 * A source period as needed for generation (pure input).
 */
export interface SourcePeriodForGeneration {
  id: string;
  period_id: string;
  period_type: PeriodInstanceType;
  start_date: Timestamp;
  end_date: Timestamp;
}

/**
 * Pure input for generating a budget's periods.
 */
export interface ComputeBudgetPeriodsInput {
  budget_id: string;
  user_id: string;
  group_ids: string[];
  budget_amount: number;
  budget_cadence: PeriodInstanceType;
  source_periods: SourcePeriodForGeneration[];
  now: Timestamp;
}

/**
 * Generates budget period entities from source periods.
 *
 * For each source period the amount is allocated by day-based math and a daily
 * rate is computed (6-decimal precision for prime periods that match the
 * budget cadence, 2-decimal for converted/non-prime periods).
 *
 * PURE FUNCTION - all non-determinism (now) is injected.
 */
export function compute_budget_periods(
  input: ComputeBudgetPeriodsInput
): DomainResult<BudgetPeriodEntity> {
  if (!input.budget_id) {
    return { validation_errors: ["budget_id is required"] };
  }
  if (input.budget_amount < 0) {
    return { validation_errors: ["budget_amount cannot be negative"] };
  }

  const entities: BudgetPeriodEntity[] = [];

  for (const source of input.source_periods) {
    const start = source.start_date.toDate();
    const end = source.end_date.toDate();

    const allocation_result = compute_period_allocation({
      budget_amount: input.budget_amount,
      budget_period_type: input.budget_cadence,
      target_start: start,
      target_end: end,
      target_period_type: source.period_type,
    });
    if (allocation_result.validation_errors) {
      return { validation_errors: allocation_result.validation_errors };
    }
    const allocated = allocation_result.entity ?? 0;

    const days = count_days_inclusive(start, end);
    const is_prime = source.period_type === input.budget_cadence;
    const rate_result = compute_daily_rate(allocated, days, is_prime);
    const daily_rate = rate_result.entity ?? 0;

    entities.push({
      id: `${input.budget_id}_${source.id}`,
      budget_id: input.budget_id,
      user_id: input.user_id,
      group_ids: input.group_ids,
      period_id: source.period_id,
      period_type: source.period_type,
      allocated_amount: allocated,
      rolled_over_amount: 0,
      effective_amount: allocated,
      spent: 0,
      remaining: allocated,
      daily_rate,
      start_date: source.start_date,
      end_date: source.end_date,
      is_active: true,
      created_at: input.now,
      updated_at: input.now,
    });
  }

  return { entities };
}

/**
 * An existing budget period as needed for re-allocation (pure input).
 */
export interface ExistingPeriodForRealloc {
  id: string;
  period_type: PeriodInstanceType;
  start_date: Timestamp;
  end_date: Timestamp;
  spent: number;
  rolled_over_amount: number;
}

/**
 * A computed allocation update for one existing period.
 */
export interface PeriodAllocationUpdate {
  id: string;
  allocated_amount: number;
  daily_rate: number;
  remaining: number;
}

/**
 * Pure input for re-allocating existing budget periods after an amount change.
 */
export interface ReallocateBudgetPeriodsInput {
  new_amount: number;
  budget_cadence: PeriodInstanceType;
  periods: ExistingPeriodForRealloc[];
  /** Only re-allocate periods that END on/after this cutoff (current + future). */
  cutoff: Timestamp;
}

/**
 * Recompute allocations for EXISTING periods after a budget's amount changes,
 * in place. Mirrors the legacy `runUpdateBudgetPeriods`:
 * - Only current + future periods (end_date >= cutoff) are re-allocated;
 *   historical periods are left untouched.
 * - Each period's allocated amount + daily rate are recomputed from the new
 *   amount and the period's own dates/type; `remaining = allocated + rolled_over
 *   - spent`.
 *
 * Returns one update per affected period (caller applies them in place,
 * preserving notes / checklist / modifiedAmount). PURE FUNCTION.
 */
export function compute_reallocated_periods(
  input: ReallocateBudgetPeriodsInput
): DomainResult<PeriodAllocationUpdate> {
  if (input.new_amount < 0) {
    return { validation_errors: ["new_amount cannot be negative"] };
  }

  const cutoff_ms = input.cutoff.toMillis();
  const updates: PeriodAllocationUpdate[] = [];

  for (const period of input.periods) {
    // Skip historical periods.
    if (period.end_date.toMillis() < cutoff_ms) {
      continue;
    }

    const start = period.start_date.toDate();
    const end = period.end_date.toDate();

    const allocation_result = compute_period_allocation({
      budget_amount: input.new_amount,
      budget_period_type: input.budget_cadence,
      target_start: start,
      target_end: end,
      target_period_type: period.period_type,
    });
    if (allocation_result.validation_errors) {
      return { validation_errors: allocation_result.validation_errors };
    }
    const allocated = allocation_result.entity ?? 0;

    const days = count_days_inclusive(start, end);
    const is_prime = period.period_type === input.budget_cadence;
    const rate_result = compute_daily_rate(allocated, days, is_prime);
    const daily_rate = rate_result.entity ?? 0;

    updates.push({
      id: period.id,
      allocated_amount: allocated,
      daily_rate,
      remaining: allocated + period.rolled_over_amount - period.spent,
    });
  }

  return { entities: updates };
}

const DAYS_IN_WEEK = 7;

/** Decimal precision for prime (source-aligned) daily rates. */
const PRIME_RATE_PRECISION = 6;

/** Decimal precision for non-prime (converted) daily rates. */
const NON_PRIME_RATE_PRECISION = 2;

/**
 * Count the inclusive number of days between two dates using UTC-normalized
 * day boundaries (avoids off-by-one from stored 23:59:59 end times).
 *
 * PURE FUNCTION.
 */
export function count_days_inclusive(start: Date, end: Date): number {
  const start_utc = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const end_utc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  const diff_days = Math.round((end_utc - start_utc) / (1000 * 60 * 60 * 24));
  return diff_days + 1;
}

/**
 * Days in a specific month (month is 0-indexed).
 *
 * PURE FUNCTION.
 */
export function days_in_month(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Round a rate to the given number of decimal places.
 *
 * PURE FUNCTION.
 */
function round_to(value: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

/**
 * Input describing the target period to allocate into.
 */
export interface PeriodAllocationInput {
  /** Budget amount in its own period denomination */
  budget_amount: number;
  /** The budget blueprint's cadence */
  budget_period_type: PeriodInstanceType;
  /** Target period start (UTC) */
  target_start: Date;
  /** Target period end (UTC, inclusive) */
  target_end: Date;
  /** Target period cadence */
  target_period_type: PeriodInstanceType;
}

/**
 * Allocate a budget amount to a single target period using day-based math.
 *
 * - Same cadence → return the budget amount unchanged.
 * - MONTHLY budgets → sum each day's rate using that day's month length,
 *   correctly handling periods that span multiple months.
 * - WEEKLY budgets → (amount / 7) * target days.
 * - BI_MONTHLY budgets → (amount / bi-monthly days) * target days.
 *
 * PURE FUNCTION.
 */
export function compute_period_allocation(
  input: PeriodAllocationInput
): DomainResult<number> {
  if (input.budget_amount < 0) {
    return { validation_errors: ["budget_amount cannot be negative"] };
  }
  if (input.target_end < input.target_start) {
    return { validation_errors: ["target_end must be on or after target_start"] };
  }

  // Same cadence: the amount maps 1:1.
  if (input.budget_period_type === input.target_period_type) {
    return { entity: input.budget_amount };
  }

  const target_days = count_days_inclusive(input.target_start, input.target_end);

  let allocation: number;
  switch (input.budget_period_type) {
  case "monthly":
    allocation = allocate_monthly_to_target(
      input.budget_amount,
      input.target_start,
      input.target_end
    );
    break;
  case "weekly": {
    const weekly_daily_rate = input.budget_amount / DAYS_IN_WEEK;
    allocation = weekly_daily_rate * target_days;
    break;
  }
  case "bi_monthly": {
    // Bi-monthly periods are ~15 days (first half) or month-length minus 15.
    const bi_monthly_days = 15;
    const bi_monthly_daily_rate = input.budget_amount / bi_monthly_days;
    allocation = bi_monthly_daily_rate * target_days;
    break;
  }
  default: {
    const fallback_daily_rate = input.budget_amount / target_days;
    allocation = fallback_daily_rate * target_days;
  }
  }

  return { entity: round_to(allocation, NON_PRIME_RATE_PRECISION) };
}

/**
 * Allocate a monthly amount across a target period day-by-day, applying each
 * day's own month length. Handles month-spanning periods.
 *
 * PURE helper.
 */
function allocate_monthly_to_target(
  monthly_amount: number,
  target_start: Date,
  target_end: Date
): number {
  let total = 0;
  const cursor = new Date(
    Date.UTC(
      target_start.getUTCFullYear(),
      target_start.getUTCMonth(),
      target_start.getUTCDate()
    )
  );
  const end_utc = Date.UTC(
    target_end.getUTCFullYear(),
    target_end.getUTCMonth(),
    target_end.getUTCDate()
  );

  while (cursor.getTime() <= end_utc) {
    const days = days_in_month(cursor.getUTCFullYear(), cursor.getUTCMonth());
    total += monthly_amount / days;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return total;
}

/**
 * Compute the daily rate for a period.
 *
 * Prime periods (aligned with the budget's own cadence) use 6-decimal
 * precision; non-prime (converted) periods use 2-decimal precision.
 *
 * PURE FUNCTION.
 */
export function compute_daily_rate(
  allocated_amount: number,
  period_days: number,
  is_prime: boolean
): DomainResult<number> {
  if (period_days <= 0) {
    return { validation_errors: ["period_days must be greater than zero"] };
  }
  const precision = is_prime ? PRIME_RATE_PRECISION : NON_PRIME_RATE_PRECISION;
  return { entity: round_to(allocated_amount / period_days, precision) };
}
