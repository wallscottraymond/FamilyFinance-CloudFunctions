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

import { Timestamp } from 'firebase-admin/firestore';
import {
  Budget,
  BudgetPeriodDocument,
  RolloverStrategy,
  FinancialSettings,
} from '../../../types';

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
    strategy: 'spread',
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
 * @returns Rollover calculation result
 */
export function calculateRolloverForPeriod(
  currentPeriod: BudgetPeriodDocument,
  previousPeriod: BudgetPeriodDocument | null,
  rolloverSettings: ResolvedRolloverSettings
): RolloverCalculationResult {
  // No rollover if disabled or no previous period
  if (!rolloverSettings.enabled || !previousPeriod) {
    return {
      rolledOverAmount: 0,
      rolledOverFromPeriodId: null,
      pendingRolloverDeduction: 0,
      pendingRolloverPeriods: 0,
    };
  }

  // Calculate previous period's surplus/deficit
  const previousAllocated = previousPeriod.modifiedAmount ?? previousPeriod.allocatedAmount;
  const previousSpent = previousPeriod.spent ?? 0;
  const previousRollover = previousPeriod.rolledOverAmount ?? 0;

  // Effective budget = allocated + any rollover received
  const previousEffective = previousAllocated + previousRollover;

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

    if (rolloverSettings.strategy === 'immediate') {
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

/**
 * Calculate the effective remaining amount for a period, including rollover.
 *
 * @param period - The budget period
 * @returns Effective remaining amount
 */
export function calculateEffectiveRemaining(period: BudgetPeriodDocument): number {
  const allocated = period.modifiedAmount ?? period.allocatedAmount;
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
