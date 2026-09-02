/**
 * Outflow Period Domain Service
 *
 * PURE business logic for calculating outflow periods.
 * No IO, no side effects, no async operations.
 *
 * @module domain/outflows/outflow_period
 */

import { Timestamp } from "firebase-admin/firestore";
import { DomainResult, success_many, validation_failed } from "../../types";
import { OutflowPeriodForPersistence } from "../../repositories/outflow_period.repo";
import { normalize_frequency } from "../recurring/frequency";

/**
 * Outflow data needed for period generation (snake_case).
 */
export interface OutflowForPeriodGeneration {
  id: string;
  owner_id: string;
  created_by: string;
  group_id: string | null;
  group_ids: string[];
  plaid_item_id: string;
  account_id: string;
  average_amount: number;
  last_amount: number;
  currency: string;
  description: string | null;
  merchant_name: string | null;
  user_custom_name: string | null;
  frequency: string;
  first_date: Timestamp;
  last_date: Timestamp;
  predicted_next_date: Timestamp | null;
  plaid_primary_category: string;
  plaid_detailed_category: string;
  internal_primary_category: string | null;
  internal_detailed_category: string | null;
  expense_type: string;
  is_essential: boolean;
  is_active: boolean;
  is_hidden: boolean;
  source: string;
  tags: string[];
  rules: unknown[];
  transaction_ids: string[];
}

/**
 * Source period data needed for period generation (snake_case).
 */
export interface SourcePeriodForOutflowGeneration {
  id: string;
  period_id: string;
  type: string;
  start_date: Timestamp;
  end_date: Timestamp;
}

/**
 * Occurrence calculation result.
 */
interface OccurrenceResult {
  number_of_occurrences: number;
  occurrence_due_dates: Timestamp[];
  total_expected_amount: number;
  next_expected_date: Timestamp | null;
  amount_withheld: number;
  cycle_days: number;
}

/**
 * Payment cycle information.
 */
interface CycleInfo {
  bill_amount: number;
  cycle_days: number;
  daily_rate: number;
  cycle_start_date: Timestamp;
  cycle_end_date: Timestamp;
}

/**
 * Normalize a frequency to a canonical UPPERCASE, underscore-free token so both
 * the app form (`"semimonthly"`, `"biweekly"`, `"yearly"`) and any legacy underscore
 * form (`"SEMI_MONTHLY"`) map to the same canonical token via the shared
 * `normalize_frequency`. A mismatch used to silently fall through to the monthly
 * default — which made a `yearly` bill generate 1 occurrence/MONTH (appearing in every
 * period) and a `semimonthly` one mis-step. Unknown now defaults to a YEARLY step so an
 * unrecognized cadence never fans out across every period.
 */

/**
 * Get approximate cycle days for a frequency.
 */
function get_cycle_days(frequency: string): number {
  switch (normalize_frequency(frequency)) {
    case "WEEKLY":
      return 7;
    case "BIWEEKLY":
      return 14;
    case "SEMIMONTHLY":
      return 15;
    case "MONTHLY":
      return 30;
    case "QUARTERLY":
      return 91;
    case "ANNUALLY":
      return 365;
    default:
      // UNKNOWN — treat as annual so it never fans out as monthly (see frequency.ts).
      return 365;
  }
}

/**
 * Get number of days in a period.
 */
function get_period_days(start: Date, end: Date): number {
  return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Add frequency interval to a date.
 */
function add_frequency_interval(date: Date, frequency: string): Date {
  // UTC date-math: anchors are stored at UTC midnight, so stepping in UTC keeps an
  // occurrence on its intended UTC day regardless of the runtime timezone.
  const result = new Date(date);

  switch (normalize_frequency(frequency)) {
    case "WEEKLY":
      result.setUTCDate(result.getUTCDate() + 7);
      break;
    case "BIWEEKLY":
      result.setUTCDate(result.getUTCDate() + 14);
      break;
    case "SEMIMONTHLY":
      // Real semi-monthly generation is day-of-month based (see semimonthly_due_dates);
      // this +15 is only a defensive fallback if the generic loop is ever used for it.
      result.setUTCDate(result.getUTCDate() + 15);
      break;
    case "MONTHLY":
      result.setUTCMonth(result.getUTCMonth() + 1);
      break;
    case "QUARTERLY":
      result.setUTCMonth(result.getUTCMonth() + 3);
      break;
    case "ANNUALLY":
      result.setUTCFullYear(result.getUTCFullYear() + 1);
      break;
    default:
      // UNKNOWN — step by a year so an unrecognized cadence never fans out monthly.
      result.setUTCFullYear(result.getUTCFullYear() + 1);
  }

  return result;
}

/**
 * Subtract frequency interval from a date.
 */
function subtract_frequency_interval(date: Date, frequency: string): Date {
  const result = new Date(date); // UTC date-math (see add_frequency_interval).

  switch (normalize_frequency(frequency)) {
    case "WEEKLY":
      result.setUTCDate(result.getUTCDate() - 7);
      break;
    case "BIWEEKLY":
      result.setUTCDate(result.getUTCDate() - 14);
      break;
    case "SEMIMONTHLY":
      result.setUTCDate(result.getUTCDate() - 15);
      break;
    case "MONTHLY":
      result.setUTCMonth(result.getUTCMonth() - 1);
      break;
    case "QUARTERLY":
      result.setUTCMonth(result.getUTCMonth() - 3);
      break;
    case "ANNUALLY":
      result.setUTCFullYear(result.getUTCFullYear() - 1);
      break;
    default:
      // UNKNOWN — mirror the forward step (a year), never monthly.
      result.setUTCFullYear(result.getUTCFullYear() - 1);
  }

  return result;
}

/**
 * Adjust date for month-end edge cases.
 */
function adjust_for_month_end(
  current_date: Date,
  reference_date: Date,
  frequency: string
): Date {
  const freq = normalize_frequency(frequency);
  if (freq !== "MONTHLY" && freq !== "QUARTERLY" && freq !== "ANNUALLY") {
    return current_date;
  }

  const original_day = reference_date.getUTCDate();
  const current_month = current_date.getUTCMonth();
  const current_year = current_date.getUTCFullYear();
  const last_day_of_month = new Date(Date.UTC(current_year, current_month + 1, 0)).getUTCDate();

  if (original_day > last_day_of_month) {
    return new Date(Date.UTC(current_year, current_month, last_day_of_month));
  }

  return current_date;
}

/** Last day-of-month for a UTC year/month0. PURE. */
function utc_last_day_of_month(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** A UTC-midnight date for year/month0/day, clamped to the month's last day. PURE. */
function utc_day(year: number, month0: number, day: number): Date {
  return new Date(Date.UTC(year, month0, Math.min(day, utc_last_day_of_month(year, month0))));
}

/**
 * The two semi-monthly days-of-month implied by an anchor date. Semi-monthly pay lands
 * on two FIXED days each month (e.g. 15th + last, or 1st + 16th) — NOT a drifting +15-day
 * chain, which slid off real paydays and emitted a phantom 3rd occurrence some months. PURE.
 */
function semimonthly_days(reference: Date): [number, number] {
  const d = reference.getUTCDate();
  return d <= 15 ? [d, d + 15] : [d - 15, d];
}

/**
 * Semi-monthly occurrence due dates within [start, end] — two per calendar month on the
 * anchor's fixed days (clamped to month-end), UTC. Replaces the +15-day stepping. PURE.
 */
function semimonthly_due_dates(reference: Date, start: Date, end: Date): Date[] {
  const [d1, d2] = semimonthly_days(reference);
  const out: Date[] = [];
  // Pad a month either side so boundary occurrences aren't missed; filter to the window.
  const start_idx = start.getUTCFullYear() * 12 + start.getUTCMonth() - 1;
  const end_idx = end.getUTCFullYear() * 12 + end.getUTCMonth() + 1;
  for (let idx = start_idx; idx <= end_idx; idx++) {
    const year = Math.floor(idx / 12);
    const month0 = ((idx % 12) + 12) % 12;
    for (const day of [d1, d2]) {
      const dt = utc_day(year, month0, day);
      if (dt >= start && dt <= end) out.push(dt);
    }
  }
  return out;
}

/**
 * Calculate payment cycle information from outflow data.
 * PURE function - no IO.
 */
function calculate_payment_cycle(outflow: OutflowForPeriodGeneration): CycleInfo {
  const bill_amount = Math.abs(outflow.average_amount);
  const cycle_days = get_cycle_days(outflow.frequency);
  const daily_rate = bill_amount / cycle_days;
  const cycle_end_date = outflow.predicted_next_date ?? outflow.last_date;
  const cycle_start_ms = cycle_end_date.toDate().getTime() - cycle_days * 24 * 60 * 60 * 1000;
  const cycle_start_date = Timestamp.fromDate(new Date(cycle_start_ms));

  return {
    bill_amount,
    cycle_days,
    daily_rate,
    cycle_start_date,
    cycle_end_date,
  };
}

/**
 * Calculate all bill occurrences within a given period.
 * PURE function - no IO.
 */
function calculate_occurrences_in_period(
  outflow: OutflowForPeriodGeneration,
  source_period: SourcePeriodForOutflowGeneration,
  cycle_info: CycleInfo
): OccurrenceResult {
  const period_start = source_period.start_date.toDate();
  const period_end = source_period.end_date.toDate();
  const frequency = outflow.frequency;
  const cycle_days = cycle_info.cycle_days;
  const amount_per_occurrence = cycle_info.bill_amount;

  // Get reference date
  let reference_date: Date;
  if (outflow.predicted_next_date) {
    reference_date = outflow.predicted_next_date.toDate();
  } else if (outflow.last_date) {
    reference_date = outflow.last_date.toDate();
  } else {
    reference_date = outflow.first_date.toDate();
  }

  // Find all occurrences that fall within the period.
  const occurrence_due_dates: Timestamp[] = [];
  let next_expected_date: Timestamp;

  if (normalize_frequency(frequency) === "SEMIMONTHLY") {
    // Semi-monthly is day-of-month based (two fixed days/month), NOT +15-day stepping.
    for (const dt of semimonthly_due_dates(reference_date, period_start, period_end)) {
      occurrence_due_dates.push(Timestamp.fromDate(dt));
    }
    // Next expected = the first semi-monthly day after the period (scan ~45 days out).
    const after = semimonthly_due_dates(
      reference_date,
      new Date(period_end.getTime() + 1),
      new Date(period_end.getTime() + 45 * 24 * 60 * 60 * 1000)
    );
    next_expected_date = Timestamp.fromDate(after[0] ?? new Date(period_end.getTime() + 1));
  } else {
    let current_date = new Date(reference_date);

    // Rewind to at/before the period start, THEN advance to the first occurrence >=
    // start. The reference (predicted_next_date) often lands inside or after the
    // period; starting collection forward from it would skip occurrences that fall
    // EARLIER in the same period.
    while (current_date > period_start) {
      current_date = subtract_frequency_interval(current_date, frequency);
    }
    while (current_date < period_start) {
      current_date = add_frequency_interval(current_date, frequency);
    }

    // Collect all occurrences within the period.
    while (current_date <= period_end) {
      if (current_date >= period_start) {
        const adjusted = adjust_for_month_end(current_date, reference_date, frequency);
        occurrence_due_dates.push(Timestamp.fromDate(adjusted));
      }
      current_date = add_frequency_interval(current_date, frequency);
    }

    // Next expected date is after the period.
    next_expected_date = Timestamp.fromDate(
      adjust_for_month_end(current_date, reference_date, frequency)
    );
  }

  const number_of_occurrences = occurrence_due_dates.length;
  const total_expected_amount = number_of_occurrences * amount_per_occurrence;

  // Calculate amount withheld (proportional distribution)
  const period_days = get_period_days(period_start, period_end);
  const amount_withheld = Math.round((amount_per_occurrence * (period_days / cycle_days)) * 100) / 100;

  return {
    number_of_occurrences,
    occurrence_due_dates,
    total_expected_amount,
    next_expected_date,
    amount_withheld,
    cycle_days,
  };
}

/**
 * The minimal recurring-item schedule needed to generate occurrences.
 * Works for outflows AND inflows (both carry frequency + anchor dates + amount).
 */
export interface RecurringScheduleForGeneration {
  frequency: string;
  average_amount: number;
  first_date: Timestamp;
  last_date: Timestamp;
  predicted_next_date: Timestamp | null;
}

/** One generated (expected) occurrence: when it's due + how much. */
export interface GeneratedOccurrence {
  due_date_ms: number;
  amount_due: number;
}

/**
 * Derive-On-Read Period Architecture — Phase 3.
 *
 * Generate a recurring item's EXPECTED occurrences within an arbitrary window,
 * FRESH from its schedule (frequency + anchor + amount). This is the read-time
 * replacement for the stale materialized period docs: it reuses the exact same
 * proven cycle + stepping logic (`calculate_payment_cycle` +
 * `calculate_occurrences_in_period`), just against a synthetic window instead of
 * a stored source period. Because it's recomputed on read, it can't go stale.
 *
 * PURE FUNCTION — no IO. Feeds `reconcile_occurrences` → `place_occurrences`.
 *
 * @param schedule        - The item's frequency + anchor dates + amount
 * @param window_start_ms - Window start (inclusive), epoch ms
 * @param window_end_ms   - Window end (inclusive), epoch ms
 */
export function generate_expected_occurrences_in_window(
  schedule: RecurringScheduleForGeneration,
  window_start_ms: number,
  window_end_ms: number
): GeneratedOccurrence[] {
  // The cycle + occurrence helpers read only a handful of fields off the outflow
  // (frequency, average_amount, first/last/predicted dates); build the minimal
  // shape and reuse them unchanged.
  const outflow = {
    frequency: schedule.frequency,
    average_amount: schedule.average_amount,
    first_date: schedule.first_date,
    last_date: schedule.last_date,
    predicted_next_date: schedule.predicted_next_date,
  } as unknown as OutflowForPeriodGeneration;

  const window: SourcePeriodForOutflowGeneration = {
    id: "window",
    period_id: "window",
    type: "custom",
    start_date: Timestamp.fromMillis(window_start_ms),
    end_date: Timestamp.fromMillis(window_end_ms),
  };

  const cycle_info = calculate_payment_cycle(outflow);
  const result = calculate_occurrences_in_period(outflow, window, cycle_info);

  return result.occurrence_due_dates.map((ts) => ({
    due_date_ms: ts.toMillis(),
    amount_due: cycle_info.bill_amount,
  }));
}

/**
 * Calculate period withholding amounts for budgeting.
 */
function calculate_period_amounts(
  source_period: SourcePeriodForOutflowGeneration,
  cycle_info: CycleInfo
): { amount_withheld: number; daily_rate: number } {
  const period_start = source_period.start_date.toDate();
  const period_end = source_period.end_date.toDate();
  const days_in_period = get_period_days(period_start, period_end);
  const amount_withheld = Math.round((cycle_info.daily_rate * days_in_period) * 100) / 100;

  return {
    amount_withheld,
    daily_rate: cycle_info.daily_rate,
  };
}

/**
 * Generate outflow periods for a given outflow and set of source periods.
 *
 * PURE function - no IO, no side effects.
 *
 * @param outflow - The outflow to generate periods for
 * @param source_periods - The source periods to generate outflow periods for
 * @param now - Current timestamp (injected for determinism)
 * @returns DomainResult with outflow periods or validation errors
 */
export function compute_outflow_periods(
  outflow: OutflowForPeriodGeneration,
  source_periods: SourcePeriodForOutflowGeneration[],
  now: Timestamp
): DomainResult<OutflowPeriodForPersistence> {
  // Validation
  if (!outflow.is_active) {
    return validation_failed(["Outflow is not active"]);
  }

  if (source_periods.length === 0) {
    return validation_failed(["No source periods provided"]);
  }

  if (!outflow.frequency) {
    return validation_failed(["Outflow is missing frequency"]);
  }

  // Calculate cycle info once
  const cycle_info = calculate_payment_cycle(outflow);

  // Generate periods
  const entities: OutflowPeriodForPersistence[] = [];

  for (const source_period of source_periods) {
    // Calculate occurrences for this period
    const occurrences = calculate_occurrences_in_period(outflow, source_period, cycle_info);

    // Calculate period amounts
    const period_amounts = calculate_period_amounts(source_period, cycle_info);

    // Determine if this is a due period (has occurrences)
    const is_due_period = occurrences.number_of_occurrences > 0;

    // Determine first/last/next due dates
    const first_due_date = occurrences.number_of_occurrences > 0
      ? occurrences.occurrence_due_dates[0]
      : null;
    const last_due_date = occurrences.number_of_occurrences > 0
      ? occurrences.occurrence_due_dates[occurrences.number_of_occurrences - 1]
      : null;
    const next_unpaid_due_date = first_due_date; // All unpaid at creation

    // Initialize occurrence tracking arrays
    const occurrence_paid_flags = new Array(occurrences.number_of_occurrences).fill(false);
    const occurrence_transaction_ids = new Array(occurrences.number_of_occurrences).fill(null);

    // Build the period entity
    const period: OutflowPeriodForPersistence = {
      // Identity
      id: `${outflow.id}_${source_period.id}`,
      outflow_id: outflow.id,
      source_period_id: source_period.id,

      // Ownership
      owner_id: outflow.owner_id,
      created_by: outflow.created_by,
      updated_by: outflow.created_by,
      group_id: outflow.group_id,
      group_ids: outflow.group_ids,

      // Plaid identifiers
      account_id: outflow.account_id,
      plaid_item_id: outflow.plaid_item_id,

      // Financial tracking
      actual_amount: null,
      amount_withheld: period_amounts.amount_withheld,
      average_amount: cycle_info.bill_amount,
      expected_amount: occurrences.total_expected_amount,
      amount_per_occurrence: cycle_info.bill_amount,
      total_amount_due: occurrences.total_expected_amount,
      total_amount_paid: 0,
      total_amount_unpaid: occurrences.total_expected_amount,

      // Timestamps
      created_at: now,
      updated_at: now,
      last_calculated: now,

      // Payment cycle info
      currency: outflow.currency,
      cycle_days: cycle_info.cycle_days,
      cycle_start_date: cycle_info.cycle_start_date,
      cycle_end_date: cycle_info.cycle_end_date,
      daily_withholding_rate: period_amounts.daily_rate,

      // Outflow metadata (denormalized)
      description: outflow.description,
      frequency: outflow.frequency,
      expense_type: outflow.expense_type,

      // Payment status (all unpaid at creation)
      is_paid: false,
      is_fully_paid: false,
      is_partially_paid: false,
      is_due_period,

      // Categorization
      internal_detailed_category: outflow.internal_detailed_category,
      internal_primary_category: outflow.internal_primary_category,
      plaid_primary_category: outflow.plaid_primary_category,
      plaid_detailed_category: outflow.plaid_detailed_category,

      // Status & control
      is_active: true,
      is_hidden: outflow.is_hidden,
      is_essential: outflow.is_essential,

      // Merchant info
      merchant_name: outflow.merchant_name,

      // Period context
      period_start_date: source_period.start_date,
      period_end_date: source_period.end_date,
      period_type: source_period.type,

      // Prediction
      predicted_next_date: occurrences.next_expected_date,

      // User interaction
      rules: outflow.rules,
      tags: outflow.tags,
      type: outflow.expense_type || "recurring",
      note: null,
      user_custom_name: outflow.user_custom_name,

      // Source
      source: outflow.source,

      // Transaction tracking
      transaction_ids: [],
      transaction_splits: [],

      // Multi-occurrence tracking
      number_of_occurrences_in_period: occurrences.number_of_occurrences,
      number_of_occurrences_paid: 0,
      number_of_occurrences_unpaid: occurrences.number_of_occurrences,
      occurrence_due_dates: occurrences.occurrence_due_dates,
      occurrence_paid_flags,
      occurrence_transaction_ids,

      // Progress metrics
      payment_progress_percentage: 0,
      dollar_progress_percentage: 0,

      // Due date tracking
      first_due_date_in_period: first_due_date,
      last_due_date_in_period: last_due_date,
      next_unpaid_due_date,
    };

    entities.push(period);
  }

  return success_many(entities);
}

/**
 * Validate outflow periods before persistence.
 *
 * PURE function - performs final validation checks.
 *
 * @param entities - Outflow periods to validate
 * @returns DomainResult with validated entities or errors
 */
export function validate_outflow_periods(
  entities: OutflowPeriodForPersistence[]
): DomainResult<OutflowPeriodForPersistence> {
  const validation_errors: string[] = [];

  for (const entity of entities) {
    if (!entity.id) {
      validation_errors.push("Outflow period missing id");
    }
    if (!entity.outflow_id) {
      validation_errors.push(`Period ${entity.id}: missing outflow_id`);
    }
    if (!entity.source_period_id) {
      validation_errors.push(`Period ${entity.id}: missing source_period_id`);
    }
    if (!entity.owner_id) {
      validation_errors.push(`Period ${entity.id}: missing owner_id`);
    }
    if (entity.average_amount < 0) {
      validation_errors.push(`Period ${entity.id}: negative average_amount`);
    }
  }

  if (validation_errors.length > 0) {
    return validation_failed(validation_errors);
  }

  return success_many(entities);
}
