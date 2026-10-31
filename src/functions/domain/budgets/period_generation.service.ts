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
  PrimePeriodBreakdownEntry,
} from "../../types/budgets/budget_entity.types";
import { ProcessBudgetCreatedPayload } from "../../types/budgets/create_budget.types";

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
): PeriodInstanceType {
  // weekly / monthly / bi_monthly are the three real prime cadences (they map 1:1
  // to source-period types). quarterly / yearly / custom have no matching source
  // period, so they allocate on the monthly grid (prime = monthly).
  if (period === "weekly") return "weekly";
  if (period === "bi_monthly") return "bi_monthly";
  return "monthly";
}

/**
 * A budget's amount expressed per PRIME period of its allocation base
 * (`budget_cadence_to_instance`). Quarterly / yearly budgets allocate on the monthly grid, so
 * each month gets a third / a twelfth of the amount (Code-Health-Review M1-H1: giving every month
 * the full amount was 3× / 12× too much). Every generator / re-allocator feeds this, never the raw
 * amount. PURE.
 */
export function budget_amount_per_instance(amount: number, period: BudgetPeriodType | string): number {
  const p = String(period ?? "monthly").toLowerCase();
  if (p === "quarterly") return amount / 3;
  if (p === "yearly") return amount / 12;
  return amount;
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
 * Build a `process_budget_created` payload that SELF-PROVISIONS a budget's
 * periods — no category claims, no Everything-Else re-homing. Used to generate
 * periods for budgets created outside the v2 create flow (the legacy Everything
 * Else budget) and to heal existing budgets that are missing their periods.
 *
 * `coverage_start` (optional) decouples the generation WINDOW START from the
 * budget's nominal start so the Everything Else catch-all can cover imported
 * HISTORICAL transactions (which Plaid dates before signup). The forward
 * horizon (`generation_end_ms`) is still derived from `start` — so the window
 * becomes [coverage_start, start + 12mo] rather than [start, start + 12mo].
 *
 * PURE FUNCTION.
 */
export function build_self_provision_budget_created_payload(args: {
  budget_id: string;
  user_id: string;
  group_ids: string[];
  budget_name: string;
  category_ids: string[];
  amount: number;
  period: BudgetPeriodType;
  start: Date;
  is_ongoing: boolean;
  budget_end_date: Date | null;
  /** Backdated window start (e.g. EE history coverage); defaults to `start`. */
  coverage_start?: Date | null;
}): ProcessBudgetCreatedPayload {
  const generation_end = compute_period_generation_end(
    args.start,
    args.is_ongoing,
    args.budget_end_date
  );
  const window_start = args.coverage_start ?? args.start;
  return {
    budget_id: args.budget_id,
    user_id: args.user_id,
    group_ids: args.group_ids,
    budget_name: args.budget_name,
    category_ids: args.category_ids,
    amount: budget_amount_per_instance(args.amount, args.period),
    cadence: budget_cadence_to_instance(args.period),
    start_ms: window_start.getTime(),
    generation_end_ms: generation_end.getTime(),
    is_recurring: args.is_ongoing,
    claims: [],
    everything_else_budget_id: null,
    // EE budgets appear only in their own period view → prime periods only.
    prime_only: true,
  };
}

/**
 * Months of HISTORICAL coverage to generate for the Everything Else catch-all
 * budget, so imported (Plaid) transactions dated before signup land in a period
 * and contribute to spend. Matches Plaid's typical max import range.
 */
export const EE_HISTORY_BACKDATE_MONTHS = 24;

/**
 * Compute the backdated coverage-window start for the Everything Else budget:
 * `reference` minus EE_HISTORY_BACKDATE_MONTHS. PURE.
 */
export function compute_ee_coverage_start(reference: Date): Date {
  const start = new Date(reference.getTime());
  start.setUTCMonth(start.getUTCMonth() - EE_HISTORY_BACKDATE_MONTHS);
  return start;
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
  /** Denormalized onto every generated period so it's self-contained. */
  category_ids: string[];
  source_periods: SourcePeriodForGeneration[];
  now: Timestamp;
  /** Ongoing budget: price non-prime days past the last generated prime (see `horizon_fill`). */
  fill_after_last_prime?: boolean;
}

/**
 * A prime period reduced to what the overlap breakdown needs (pure helper).
 */
interface PrimePeriodForContribution {
  /** budget_period id of the prime period (`${budget_id}_${source.id}`) */
  id: string;
  source_period_id: string;
  start: Date;
  end: Date;
  daily_rate: number;
}

/**
 * Generates budget period entities from source periods.
 *
 * Runs in two passes to mirror the legacy prime/non-prime model:
 *  1. PRIME periods (cadence === budget cadence) are allocated 1:1 with the
 *     budget amount, with a 6-decimal daily rate.
 *  2. NON-PRIME periods (other cadences) derive their allocation by summing the
 *     daily rates of the prime periods they overlap, day by day. Each non-prime
 *     period records a `prime_period_breakdown` (one entry per contributing
 *     prime) so the mobile editor can explain the allocation, plus a 2-decimal
 *     daily rate.
 *
 * This restores the `primePeriodBreakdown` / `isPrime` / `primePeriodIds` data
 * that the legacy non-prime generator produced (and the mobile non-prime editor
 * consumes), within the v2 pure-domain layer.
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

  const make_base = (
    source: SourcePeriodForGeneration,
    allocated: number,
    daily_rate: number
  ): BudgetPeriodEntity => ({
    id: `${input.budget_id}_${source.id}`,
    budget_id: input.budget_id,
    user_id: input.user_id,
    group_ids: input.group_ids,
    category_ids: input.category_ids,
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

  // Pass 1: prime periods (cadence matches the budget) — allocated 1:1.
  const prime_entities: BudgetPeriodEntity[] = [];
  const primes_for_contrib: PrimePeriodForContribution[] = [];
  for (const source of input.source_periods) {
    if (source.period_type !== input.budget_cadence) {
      continue;
    }
    const start = source.start_date.toDate();
    const end = source.end_date.toDate();
    const allocated = input.budget_amount;
    const days = count_days_inclusive(start, end);
    const rate_result = compute_daily_rate(allocated, days, true);
    if (rate_result.validation_errors) {
      return { validation_errors: rate_result.validation_errors };
    }
    const daily_rate = rate_result.entity ?? 0;

    const entity = make_base(source, allocated, daily_rate);
    entity.is_prime = true;
    entity.days_in_period = days;
    entity.prime_period_ids = [];
    entity.prime_period_breakdown = [];
    prime_entities.push(entity);
    primes_for_contrib.push({
      id: entity.id,
      source_period_id: source.period_id,
      start,
      end,
      daily_rate,
    });
  }

  // Pass 2: non-prime periods — allocation derived from overlapping primes.
  const fill = horizon_fill(input.fill_after_last_prime, primes_for_contrib, input.budget_amount, input.budget_cadence);
  const non_prime_entities: BudgetPeriodEntity[] = [];
  for (const source of input.source_periods) {
    if (source.period_type === input.budget_cadence) {
      continue;
    }
    const start = source.start_date.toDate();
    const end = source.end_date.toDate();

    const overlapping = primes_for_contrib.filter(
      (p) => p.start <= end && p.end >= start
    );
    const { total_amount, breakdown } = compute_prime_contributions(
      start,
      end,
      overlapping,
      fill
    );
    const allocated = round_to(total_amount, NON_PRIME_RATE_PRECISION);

    const days = count_days_inclusive(start, end);
    const rate_result = compute_daily_rate(allocated, days, false);
    if (rate_result.validation_errors) {
      return { validation_errors: rate_result.validation_errors };
    }
    const daily_rate = rate_result.entity ?? 0;

    const entity = make_base(source, allocated, daily_rate);
    entity.is_prime = false;
    entity.days_in_period = days;
    entity.prime_period_ids = overlapping.map((p) => p.id);
    entity.prime_period_breakdown = breakdown;
    non_prime_entities.push(entity);
  }

  return { entities: [...prime_entities, ...non_prime_entities] };
}

/**
 * Sum the daily rates of the prime periods overlapping a non-prime period,
 * day by day, building a per-prime contribution breakdown.
 *
 * Ported from the legacy `calculatePrimeContributions` (day-by-day SUMPRODUCT):
 * for each UTC day in the target period, find the prime period containing it,
 * add that prime's daily rate to the running total and to that prime's
 * contribution. `amount_contributed` is rounded to 2 decimals per prime.
 *
 * `uncovered_day_rate` prices a day no given prime covers (`horizon_fill`: past the last
 * generated prime of an ongoing budget). Those days add to the total only; the breakdown lists
 * real prime docs.
 *
 * PURE FUNCTION.
 */
export function compute_prime_contributions(
  target_start: Date,
  target_end: Date,
  overlapping_primes: PrimePeriodForContribution[],
  uncovered_day_rate?: (day: Date) => number
): { total_amount: number; breakdown: PrimePeriodBreakdownEntry[] } {
  if (overlapping_primes.length === 0 && !uncovered_day_rate) {
    return { total_amount: 0, breakdown: [] };
  }

  // Map every UTC day covered by a prime to that prime (inclusive of bounds).
  const primes_by_day = new Map<string, PrimePeriodForContribution>();
  for (const prime of overlapping_primes) {
    for (const key of utc_day_keys(prime.start, prime.end)) {
      primes_by_day.set(key, prime);
    }
  }

  interface Contribution {
    prime: PrimePeriodForContribution;
    days_contributed: number;
    amount_contributed: number;
    overlap_start: Date | null;
    overlap_end: Date | null;
  }
  const contributions = new Map<string, Contribution>();
  let total_amount = 0;

  let cursor = Date.UTC(
    target_start.getUTCFullYear(),
    target_start.getUTCMonth(),
    target_start.getUTCDate()
  );
  const end_utc = Date.UTC(
    target_end.getUTCFullYear(),
    target_end.getUTCMonth(),
    target_end.getUTCDate()
  );

  while (cursor <= end_utc) {
    const day = new Date(cursor);
    const key = utc_day_key(day);
    const prime = primes_by_day.get(key);
    if (prime) {
      total_amount += prime.daily_rate;
      let c = contributions.get(prime.id);
      if (!c) {
        c = {
          prime,
          days_contributed: 0,
          amount_contributed: 0,
          overlap_start: null,
          overlap_end: null,
        };
        contributions.set(prime.id, c);
      }
      c.days_contributed += 1;
      c.amount_contributed += prime.daily_rate;
      if (c.overlap_start === null) {
        c.overlap_start = day;
      }
      c.overlap_end = day;
    } else if (uncovered_day_rate) {
      total_amount += uncovered_day_rate(day);
    }
    cursor += MS_PER_DAY;
  }

  const breakdown: PrimePeriodBreakdownEntry[] = [];
  for (const c of contributions.values()) {
    breakdown.push({
      prime_period_id: c.prime.id,
      source_period_id: c.prime.source_period_id,
      days_contributed: c.days_contributed,
      daily_rate: c.prime.daily_rate,
      amount_contributed: round_to(c.amount_contributed, NON_PRIME_RATE_PRECISION),
      overlap_start: Timestamp.fromDate(c.overlap_start ?? c.prime.start),
      overlap_end: Timestamp.fromDate(c.overlap_end ?? c.prime.end),
    });
  }

  return { total_amount, breakdown };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** A stored non-prime period as the extension refresh needs it (pure input). */
export interface StoredNonPrimeForRefresh {
  id: string;
  allocated_amount: number;
  spent: number;
  rolled_over_amount: number;
  end_ms: number;
  /** "This Period Only" amount or adjustments set by the user — never re-priced here. */
  is_user_edited: boolean;
}

/**
 * Which EXISTING non-prime periods the extension cron re-prices (Code-Health-Review batch 6
 * verify #2). The cron only adds missing periods, so a monthly record generated at the far edge
 * of the window before its later weeks existed stayed short for good. Re-price a stored non-prime
 * when it is current / future (ends on/after `cutoff_ms`), not user-edited, and its freshly
 * computed allocation differs by a cent or more. `remaining` keeps its spend + rollover. PURE.
 */
export function stale_non_prime_refreshes(
  computed: BudgetPeriodEntity[],
  stored: StoredNonPrimeForRefresh[],
  cutoff_ms: number
): PeriodAllocationUpdate[] {
  const fresh = new Map(computed.filter((e) => e.is_prime === false).map((e) => [e.id, e]));
  const out: PeriodAllocationUpdate[] = [];
  for (const s of stored) {
    const e = fresh.get(s.id);
    if (!e || s.is_user_edited || s.end_ms < cutoff_ms) continue;
    if (Math.abs(e.allocated_amount - s.allocated_amount) < 0.01) continue;
    out.push({
      id: s.id,
      allocated_amount: e.allocated_amount,
      daily_rate: e.daily_rate,
      remaining: e.allocated_amount + s.rolled_over_amount - s.spent,
      is_prime: false,
      prime_period_ids: e.prime_period_ids ?? [],
      prime_period_breakdown: e.prime_period_breakdown ?? [],
    });
  }
  return out;
}

/**
 * A brand-new budget's monthly record before generation has run (derive synthesizes it so the
 * limit shows instantly): the same price generation will store — each priced day of the month at
 * its prime's daily rate. (A flat "amount × 52/12" disagreed with the stored docs.) PURE.
 */
export function synthesize_monthly_allocation(
  amount: number,
  period: BudgetPeriodType | string,
  month_start_ms: number,
  month_end_ms: number,
  priced: { from_ms: number; to_ms: number | null }
): number {
  const cadence = budget_cadence_to_instance(String(period ?? "monthly").toLowerCase() as BudgetPeriodType);
  const per_instance = budget_amount_per_instance(amount, period);
  if (cadence === "monthly") {
    // Whole months by construction (the start snaps to the month): the amount itself.
    return priced.to_ms != null && priced.to_ms < month_start_ms ? 0 : per_instance;
  }
  const from = Math.max(month_start_ms, priced.from_ms);
  const to = priced.to_ms == null ? month_end_ms : Math.min(month_end_ms, priced.to_ms);
  let total = 0;
  for (let day = Math.floor(from / MS_PER_DAY) * MS_PER_DAY; day <= to; day += MS_PER_DAY) {
    total += prime_daily_rate_on(per_instance, cadence, new Date(day));
  }
  return round_to(total, NON_PRIME_RATE_PRECISION);
}

/**
 * Price for the non-prime days PAST the last generated prime of an ONGOING budget — the far edge
 * of the 12-month window, where e.g. a weekly budget's last monthly doc held only the weeks
 * generated so far. The extension cron adds the later weeks but never rewrites that month, so it
 * stayed short for good (Code-Health-Review M1-H3). Days BEFORE the first prime (before the
 * budget starts) and after a limited budget's end stay unpriced: the budget isn't active then.
 * PURE.
 */
function horizon_fill(
  enabled: boolean | undefined,
  primes: PrimePeriodForContribution[],
  prime_amount: number,
  cadence: PeriodInstanceType
): ((day: Date) => number) | undefined {
  if (!enabled || primes.length === 0) return undefined;
  const last_end = Math.max(...primes.map((p) => Date.UTC(
    p.end.getUTCFullYear(), p.end.getUTCMonth(), p.end.getUTCDate()
  )));
  return (day) => (day.getTime() > last_end ? prime_daily_rate_on(prime_amount, cadence, day) : 0);
}

/**
 * The daily rate the PRIME period of `cadence` containing `day` would have (same rounding as a
 * generated prime): weekly = amount / 7; monthly = amount / the month's days; bi_monthly =
 * amount / the half's days (1st–15th, 16th–end, matching the source periods). PURE.
 */
export function prime_daily_rate_on(
  prime_amount: number,
  cadence: PeriodInstanceType,
  day: Date
): number {
  const dim = days_in_month(day.getUTCFullYear(), day.getUTCMonth());
  let days: number;
  if (cadence === "weekly") days = DAYS_IN_WEEK;
  else if (cadence === "bi_monthly") days = day.getUTCDate() <= 15 ? 15 : dim - 15;
  else days = dim;
  return round_to(prime_amount / days, PRIME_RATE_PRECISION);
}

/** UTC `YYYY-MM-DD` key for a date. PURE. */
function utc_day_key(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** All inclusive UTC day keys between two dates. PURE. */
function utc_day_keys(start: Date, end: Date): string[] {
  const keys: string[] = [];
  let cursor = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate()
  );
  const end_utc = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate()
  );
  while (cursor <= end_utc) {
    keys.push(utc_day_key(new Date(cursor)));
    cursor += MS_PER_DAY;
  }
  return keys;
}

/**
 * An existing budget period as needed for re-allocation (pure input).
 */
export interface ExistingPeriodForRealloc {
  id: string;
  period_id: string;
  period_type: PeriodInstanceType;
  start_date: Timestamp;
  end_date: Timestamp;
  spent: number;
  rolled_over_amount: number;
  /** The period's current daily rate — retained for historical primes. */
  daily_rate: number;
}

/**
 * A computed allocation update for one existing period.
 */
export interface PeriodAllocationUpdate {
  id: string;
  allocated_amount: number;
  daily_rate: number;
  remaining: number;
  is_prime?: boolean;
  prime_period_ids?: string[];
  prime_period_breakdown?: PrimePeriodBreakdownEntry[];
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
  /** Ongoing budget: price non-prime days past the last prime (see `horizon_fill`). */
  fill_after_last_prime?: boolean;
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
  const is_historical = (p: ExistingPeriodForRealloc): boolean =>
    p.end_date.toMillis() < cutoff_ms;

  // Pass 1: prime periods. Current+future primes get the new daily rate (and an
  // update); historical primes keep their existing rate (no update) so they
  // still contribute correctly to any boundary-spanning non-prime period.
  const updates: PeriodAllocationUpdate[] = [];
  const primes_for_contrib: PrimePeriodForContribution[] = [];
  for (const period of input.periods) {
    if (period.period_type !== input.budget_cadence) {
      continue;
    }
    const start = period.start_date.toDate();
    const end = period.end_date.toDate();
    const days = count_days_inclusive(start, end);

    let effective_rate = period.daily_rate;
    if (!is_historical(period)) {
      const allocated = input.new_amount;
      const rate_result = compute_daily_rate(allocated, days, true);
      if (rate_result.validation_errors) {
        return { validation_errors: rate_result.validation_errors };
      }
      effective_rate = rate_result.entity ?? 0;
      updates.push({
        id: period.id,
        allocated_amount: allocated,
        daily_rate: effective_rate,
        remaining: allocated + period.rolled_over_amount - period.spent,
        is_prime: true,
        prime_period_ids: [],
        prime_period_breakdown: [],
      });
    }
    primes_for_contrib.push({
      id: period.id,
      source_period_id: period.period_id,
      start,
      end,
      daily_rate: effective_rate,
    });
  }

  // Pass 2: non-prime periods (current+future only) — re-derive allocation and
  // breakdown from the (now updated) overlapping prime rates.
  const fill = horizon_fill(input.fill_after_last_prime, primes_for_contrib, input.new_amount, input.budget_cadence);
  for (const period of input.periods) {
    if (period.period_type === input.budget_cadence || is_historical(period)) {
      continue;
    }
    const start = period.start_date.toDate();
    const end = period.end_date.toDate();

    const overlapping = primes_for_contrib.filter(
      (p) => p.start <= end && p.end >= start
    );
    const { total_amount, breakdown } = compute_prime_contributions(
      start,
      end,
      overlapping,
      fill
    );
    const allocated = round_to(total_amount, NON_PRIME_RATE_PRECISION);

    const days = count_days_inclusive(start, end);
    const rate_result = compute_daily_rate(allocated, days, false);
    if (rate_result.validation_errors) {
      return { validation_errors: rate_result.validation_errors };
    }
    const daily_rate = rate_result.entity ?? 0;

    updates.push({
      id: period.id,
      allocated_amount: allocated,
      daily_rate,
      remaining: allocated + period.rolled_over_amount - period.spent,
      is_prime: false,
      prime_period_ids: overlapping.map((p) => p.id),
      prime_period_breakdown: breakdown,
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
