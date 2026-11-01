/**
 * Budget Rollover Calculation Utility
 *
 * Handles real-time calculation of rollover amounts between budget periods.
 * Rollover carries surplus (underspend) or deficit (overspend) from previous periods.
 *
 * Key behaviors:
 * - Per-budget settings override global user preferences
 * - Both prime and non-prime periods calculate rollover independently
 * - Spread strategy distributes overspend across multiple periods (max 6)
 * - Extreme overspend can result in negative remaining amounts
 */

import {
  direct_period_override,
  period_allocation,
} from "../../domain/budgets/period_override.service";
import { bucket_allocation_unpaused } from "../../domain/budgets/period_allocation_view.service";
import {
  PausedDayRange,
  day_from_iso,
  normalize_paused_ranges,
  paused_days_in,
} from "../../domain/budgets/budget_pause.service";
import {
  budget_priced_range,
  budget_to_match_input,
} from "../../domain/budgets/match_budgets.service";
import { Timestamp } from "firebase-admin/firestore";
import {
  Budget,
  BudgetPeriodDocument,
  RolloverStrategy,
  FinancialSettings,
} from "../../../types";

/**
 * Rollover settings resolved from budget or user preferences
 */
export interface ResolvedRolloverSettings {
  enabled: boolean;
  strategy: RolloverStrategy;
  spreadPeriods: number;
}

/**
 * Result of rollover calculation for a period
 */
export interface RolloverCalculationResult {
  /** Amount to add/subtract from this period's budget (positive = surplus, negative = deficit) */
  rolledOverAmount: number;
  /** ID of the period this rollover came from */
  rolledOverFromPeriodId: string | null;
  /** For spread: remaining amount to deduct from future periods */
  pendingRolloverDeduction: number;
  /** For spread: number of periods remaining for deduction */
  pendingRolloverPeriods: number;
}

/**
 * Get effective rollover settings for a budget.
 * Per-budget settings take precedence over global user preferences.
 *
 * @param budget - The budget document
 * @param userFinancialSettings - User's global financial settings (optional)
 * @returns Resolved rollover settings
 */
export function getEffectiveRolloverSettings(
  budget: Budget,
  userFinancialSettings?: Partial<FinancialSettings>
): ResolvedRolloverSettings {
  // Default values if nothing is set
  const defaults: ResolvedRolloverSettings = {
    enabled: true,
    strategy: "spread",
    spreadPeriods: 3,
  };

  // Get global settings from user preferences
  const globalEnabled = userFinancialSettings?.budgetRolloverEnabled ?? defaults.enabled;
  const globalStrategy = userFinancialSettings?.budgetRolloverStrategy ?? defaults.strategy;
  const globalSpreadPeriods = userFinancialSettings?.budgetRolloverSpreadPeriods ?? defaults.spreadPeriods;

  // Per-budget settings override global (use ?? to allow explicit false)
  return {
    enabled: budget.rolloverEnabled ?? globalEnabled,
    strategy: budget.rolloverStrategy ?? globalStrategy,
    spreadPeriods: Math.min(6, Math.max(1, budget.rolloverSpreadPeriods ?? globalSpreadPeriods)),
  };
}

/**
 * Calculate the rollover amount for a budget period.
 *
 * This function performs real-time calculation based on the previous period's
 * spending and any pending spread deductions.
 *
 * @param currentPeriod - The period to calculate rollover for
 * @param previousPeriod - The previous period of the same type (null for first period)
 * @param rolloverSettings - Resolved rollover settings for this budget
 * @param nowMs - "Now". Only an ENDED previous period carries anything forward: a current or
 *   future period has spent little or nothing yet, so its whole allocation would roll into the
 *   next, and the next… (Code-Health-Review M1-H2: the chain compounded through future months).
 *   The 03:00 cron rolls a period over the day after it ends.
 * @returns Rollover calculation result
 */
/** A budget's pause, as the rollover chain needs it (Code-Health-Review PZ6). */
export interface RolloverPause {
  ranges: PausedDayRange[];
  /** The days the budget's monthly records are priced for (as the page spreads them). */
  priced?: { from_ms: number; to_ms: number | null };
}

/** The budget doc's pause (stored "YYYY-MM-DD" ranges) + pricing, or undefined if never paused. */
export function rolloverPauseOf(budget: Budget): RolloverPause | undefined {
  const raw = (budget as unknown as { pausedRanges?: Array<{ start?: unknown; end?: unknown }> }).pausedRanges;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const ranges: PausedDayRange[] = [];
  for (const r of raw) {
    const a = typeof r?.start === "string" ? day_from_iso(r.start) : null;
    const b = typeof r?.end === "string" ? day_from_iso(r.end) : null;
    if (a !== null && b !== null && b >= a) ranges.push({ start_day: a, end_day: b });
  }
  if (ranges.length === 0) return undefined;
  const b = budget as unknown as {
    id: string; name?: string; period?: string; startDate?: { toMillis(): number };
    budgetEndDate?: { toMillis(): number } | null; endDate?: { toMillis(): number } | null;
    isOngoing?: boolean;
  };
  const priced = b.startDate
    ? (() => {
      const mi = budget_to_match_input({
        id: b.id, name: b.name ?? "", period: b.period ?? "monthly", start_date: b.startDate,
        end_date: b.endDate ?? null, budget_end_date: b.budgetEndDate ?? null, is_ongoing: b.isOngoing ?? true,
      });
      return budget_priced_range(mi.start_ms, mi.cadence, mi.is_ongoing, mi.end_ms);
    })()
    : undefined;
  return { ranges: normalize_paused_ranges(ranges), priced };
}

/**
 * The previous period's effective amount AS THE PAGE SHOWS IT when part of it is paused: only
 * its unpaused days' share of the base, its "This Period Only" adjustments and its rollover-in
 * (the same `bucket_allocation_unpaused` the page uses). Null when no paused day falls in it.
 */
function pausedPeriodEffective(period: BudgetPeriodDocument, pause: RolloverPause | undefined): number | null {
  if (!pause) return null;
  const start = toMs(period.periodStart);
  const end = toMs(period.periodEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (paused_days_in(pause.ranges, start, end) === 0) return null;
  const base = direct_period_override(period) ?? period.allocatedAmount ?? 0;
  const raw = (period as unknown as {
    periodAdjustments?: Array<{ periodId?: unknown; startMs?: unknown; endMs?: unknown; amount?: unknown }>;
  }).periodAdjustments ?? [];
  const adjustments = raw
    .filter((a) => typeof a?.periodId === "string" && typeof a.startMs === "number" &&
      typeof a.endMs === "number" && typeof a.amount === "number")
    .map((a) => ({ period_id: a.periodId as string, start_ms: a.startMs as number, end_ms: a.endMs as number, amount: a.amount as number }));
  return bucket_allocation_unpaused(
    [{
      allocated_amount: base,
      effective_amount: base + (period.rolledOverAmount ?? 0),
      adjustments,
      start_ms: start,
      end_ms: end,
    }],
    start,
    end,
    pause.priced,
    pause.ranges
  ).effective;
}

export function calculateRolloverForPeriod(
  currentPeriod: BudgetPeriodDocument,
  previousPeriod: BudgetPeriodDocument | null,
  rolloverSettings: ResolvedRolloverSettings,
  nowMs: number = Date.now(),
  pause?: RolloverPause
): RolloverCalculationResult {
  // No rollover if disabled, no previous period, or the previous period hasn't ended yet
  if (!rolloverSettings.enabled || !previousPeriod || !periodEndedBy(previousPeriod, nowMs)) {
    return {
      rolledOverAmount: 0,
      rolledOverFromPeriodId: null,
      pendingRolloverDeduction: 0,
      pendingRolloverPeriods: 0,
    };
  }

  // Calculate previous period's surplus/deficit
  // "This Period Only" counts only when set directly on the budget's own period (not a synced
  // copy).
  const previousAllocated = period_allocation(previousPeriod);
  const previousSpent = previousPeriod.spent ?? 0;
  const previousRollover = previousPeriod.rolledOverAmount ?? 0;

  // Effective budget = allocated + any rollover received. With paused days in it (PZ6): only the
  // unpaused share, exactly as its page shows it — its stored `spent` already leaves them out.
  const previousEffective =
    pausedPeriodEffective(previousPeriod, pause) ?? previousAllocated + previousRollover;

  // Surplus (positive) or deficit (negative)
  const surplusDeficit = previousEffective - previousSpent;

  // Also factor in any pending spread deduction from earlier periods
  const priorPendingDeduction = previousPeriod.pendingRolloverDeduction ?? 0;
  const priorPendingPeriods = previousPeriod.pendingRolloverPeriods ?? 0;

  let rolledOverAmount = 0;
  let pendingRolloverDeduction = 0;
  let pendingRolloverPeriods = 0;

  if (surplusDeficit >= 0) {
    // UNDERSPEND: Carry surplus forward
    rolledOverAmount = surplusDeficit;

    // If there was pending deduction, it's now cleared since we had surplus
    // (This is a simplification - could alternatively reduce surplus by pending amount)
  } else {
    // OVERSPEND: Handle based on strategy
    const deficit = Math.abs(surplusDeficit);

    if (rolloverSettings.strategy === "immediate") {
      // Immediate: Take full hit in next period
      rolledOverAmount = -deficit;
    } else {
      // Spread: Distribute deficit across multiple periods
      const spreadPeriods = rolloverSettings.spreadPeriods;
      const perPeriodDeduction = Math.round((deficit / spreadPeriods) * 100) / 100;

      rolledOverAmount = -perPeriodDeduction;
      pendingRolloverDeduction = deficit - perPeriodDeduction;
      pendingRolloverPeriods = spreadPeriods - 1;
    }
  }

  // Add any continuing spread deduction from prior periods
  if (priorPendingPeriods > 0 && priorPendingDeduction > 0) {
    const perPeriodPriorDeduction = Math.round((priorPendingDeduction / priorPendingPeriods) * 100) / 100;
    rolledOverAmount -= perPeriodPriorDeduction;

    // Track remaining prior deduction
    if (priorPendingPeriods > 1) {
      pendingRolloverDeduction += (priorPendingDeduction - perPeriodPriorDeduction);
      pendingRolloverPeriods = Math.max(pendingRolloverPeriods, priorPendingPeriods - 1);
    }
  }

  return {
    rolledOverAmount: Math.round(rolledOverAmount * 100) / 100,
    rolledOverFromPeriodId: previousPeriod.id ?? null,
    pendingRolloverDeduction: Math.round(pendingRolloverDeduction * 100) / 100,
    pendingRolloverPeriods,
  };
}

/** A period bound as epoch ms (Timestamp, Date, or anything Date accepts). */
function toMs(v: unknown): number {
  return v instanceof Timestamp
    ? v.toMillis()
    : v && typeof (v as { toMillis?: unknown }).toMillis === "function"
      ? (v as { toMillis(): number }).toMillis()
      : new Date(v as string | number | Date).getTime();
}

/** True when the period's last moment is before `nowMs`. */
function periodEndedBy(period: BudgetPeriodDocument, nowMs: number): boolean {
  const end = period.periodEnd as unknown;
  const endMs = end instanceof Timestamp
    ? end.toMillis()
    : end && typeof (end as { toMillis?: unknown }).toMillis === "function"
      ? (end as { toMillis(): number }).toMillis()
      : new Date(end as string | number | Date).getTime();
  return Number.isFinite(endMs) && endMs < nowMs;
}

/**
 * Calculate the effective remaining amount for a period, including rollover.
 *
 * @param period - The budget period
 * @returns Effective remaining amount
 */
export function calculateEffectiveRemaining(period: BudgetPeriodDocument): number {
  const allocated = period_allocation(period);
  const rollover = period.rolledOverAmount ?? 0;
  const spent = period.spent ?? 0;

  // Effective = allocated + rollover (can be negative for overspend)
  return Math.round((allocated + rollover - spent) * 100) / 100;
}

/**
 * Find the previous period of the same type for a given period.
 *
 * @param periods - Array of budget periods sorted by periodStart descending
 * @param currentPeriod - The current period
 * @returns The previous period of the same type, or null if none exists
 */
export function findPreviousPeriodOfSameType(
  periods: BudgetPeriodDocument[],
  currentPeriod: BudgetPeriodDocument
): BudgetPeriodDocument | null {
  const currentStart = currentPeriod.periodStart instanceof Timestamp
    ? currentPeriod.periodStart.toDate()
    : new Date(currentPeriod.periodStart as any);

  // Find periods of same type that end before current period starts
  const previousPeriods = periods.filter(p => {
    if (p.periodType !== currentPeriod.periodType) return false;
    if (p.id === currentPeriod.id) return false;

    const pEnd = p.periodEnd instanceof Timestamp
      ? p.periodEnd.toDate()
      : new Date(p.periodEnd as any);

    return pEnd < currentStart;
  });

  if (previousPeriods.length === 0) return null;

  // Return the most recent one (closest to current period)
  return previousPeriods.reduce((latest, p) => {
    const latestEnd = latest.periodEnd instanceof Timestamp
      ? latest.periodEnd.toDate()
      : new Date(latest.periodEnd as any);
    const pEnd = p.periodEnd instanceof Timestamp
      ? p.periodEnd.toDate()
      : new Date(p.periodEnd as any);

    return pEnd > latestEnd ? p : latest;
  });
}

/**
 * Check if a period is in the past (ended before today).
 *
 * @param period - The budget period
 * @returns True if the period has ended
 */
export function isPeriodInPast(period: BudgetPeriodDocument): boolean {
  const periodEnd = period.periodEnd instanceof Timestamp
    ? period.periodEnd.toDate()
    : new Date(period.periodEnd as any);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return periodEnd < today;
}
