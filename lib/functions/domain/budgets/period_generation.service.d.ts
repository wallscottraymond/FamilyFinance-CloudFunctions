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
import { BudgetPeriodEntity, BudgetPeriodType, PrimePeriodBreakdownEntry } from "../../types/budgets/budget_entity.types";
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
export declare function budget_cadence_to_instance(period: BudgetPeriodType): "weekly" | "monthly";
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
export declare function compute_period_generation_end(start: Date, is_ongoing: boolean, budget_end_date: Date | null): Date;
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
export declare function build_self_provision_budget_created_payload(args: {
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
}): ProcessBudgetCreatedPayload;
/**
 * Months of HISTORICAL coverage to generate for the Everything Else catch-all
 * budget, so imported (Plaid) transactions dated before signup land in a period
 * and contribute to spend. Matches Plaid's typical max import range.
 */
export declare const EE_HISTORY_BACKDATE_MONTHS = 24;
/**
 * Compute the backdated coverage-window start for the Everything Else budget:
 * `reference` minus EE_HISTORY_BACKDATE_MONTHS. PURE.
 */
export declare function compute_ee_coverage_start(reference: Date): Date;
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
export declare function compute_budget_periods(input: ComputeBudgetPeriodsInput): DomainResult<BudgetPeriodEntity>;
/**
 * Sum the daily rates of the prime periods overlapping a non-prime period,
 * day by day, building a per-prime contribution breakdown.
 *
 * Ported from the legacy `calculatePrimeContributions` (day-by-day SUMPRODUCT):
 * for each UTC day in the target period, find the prime period containing it,
 * add that prime's daily rate to the running total and to that prime's
 * contribution. `amount_contributed` is rounded to 2 decimals per prime.
 *
 * PURE FUNCTION.
 */
export declare function compute_prime_contributions(target_start: Date, target_end: Date, overlapping_primes: PrimePeriodForContribution[]): {
    total_amount: number;
    breakdown: PrimePeriodBreakdownEntry[];
};
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
export declare function compute_reallocated_periods(input: ReallocateBudgetPeriodsInput): DomainResult<PeriodAllocationUpdate>;
/**
 * Count the inclusive number of days between two dates using UTC-normalized
 * day boundaries (avoids off-by-one from stored 23:59:59 end times).
 *
 * PURE FUNCTION.
 */
export declare function count_days_inclusive(start: Date, end: Date): number;
/**
 * Days in a specific month (month is 0-indexed).
 *
 * PURE FUNCTION.
 */
export declare function days_in_month(year: number, month: number): number;
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
export declare function compute_period_allocation(input: PeriodAllocationInput): DomainResult<number>;
/**
 * Compute the daily rate for a period.
 *
 * Prime periods (aligned with the budget's own cadence) use 6-decimal
 * precision; non-prime (converted) periods use 2-decimal precision.
 *
 * PURE FUNCTION.
 */
export declare function compute_daily_rate(allocated_amount: number, period_days: number, is_prime: boolean): DomainResult<number>;
export {};
//# sourceMappingURL=period_generation.service.d.ts.map