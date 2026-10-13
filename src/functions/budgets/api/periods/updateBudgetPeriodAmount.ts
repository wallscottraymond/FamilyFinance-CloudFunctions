/**
 * Update Budget Period Amount
 *
 * Callable function to update a budget period's amount with proper cascade
 * to non-prime periods. Supports two modes:
 * - 'this_period': Update single period + cascade to referencing non-primes
 * - 'all_forward': Update budget base amount + all current/future periods
 *
 * Key features:
 * - Blocks updates to past/historical periods
 * - Atomic transaction for all updates
 * - Proper cascade to non-prime periods using SUMPRODUCT
 * - Recalculates dailyRate, remaining, and primePeriodBreakdown
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { budget_share_of_period } from "../../../domain/budgets/period_share.service";
import { period_allocation } from "../../../domain/budgets/period_override.service";
import { onCall, CallableRequest, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  Budget,
  BudgetPeriodDocument,
  UserRole,
  PeriodType,
} from '../../../../types';
import { authenticateRequest } from '../../../../utils/auth';
import { create_trace_context } from '../../../observability';
import { group_repo } from '../../../repositories/sharing';
import { can_manage_budget, group_id_of_key } from '../../../domain/sharing/budget_view.service';
import {
  findOverlappingPrimePeriods,
  calculatePrimeContributions,
} from '../../utils/nonPrimePeriodGeneration';

// ============================================================================
// TYPES
// ============================================================================

type CascadeScope = 'this_period' | 'all_forward';

interface UpdateBudgetPeriodAmountRequest {
  budgetPeriodId: string;
  newAmount: number;
  cascadeScope: CascadeScope;
}

interface UpdateBudgetPeriodAmountResponse {
  success: boolean;
  periodsUpdated: number;
  budgetUpdated: boolean;
  warnings: string[];
  error?: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get today's date at midnight UTC for period comparison
 */
function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Check if a period is in the past (historical)
 * Past = periodEnd < today
 */
function isPastPeriod(periodEnd: Timestamp): boolean {
  const today = getTodayUTC();
  return periodEnd.toDate() < today;
}

/**
 * Check if a period is current or future
 * Current + future = periodEnd >= today
 */
function isCurrentOrFuturePeriod(periodEnd: Timestamp): boolean {
  return !isPastPeriod(periodEnd);
}

/**
 * Calculate days in a period (inclusive, UTC-normalized)
 */
function getDaysInPeriod(startDate: Timestamp, endDate: Timestamp): number {
  const start = startDate.toDate();
  const end = endDate.toDate();

  const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());

  const diffDays = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24));
  return diffDays + 1;
}

/** Inclusive UTC days two periods share (0 when they don't overlap). */
function overlapDays(
  aStart: Timestamp,
  aEnd: Timestamp,
  bStart: Timestamp,
  bEnd: Timestamp
): number {
  const day = (t: Timestamp): number => {
    const d = t.toDate();
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000;
  };
  const from = Math.max(day(aStart), day(bStart));
  const to = Math.min(day(aEnd), day(bEnd));
  return to >= from ? to - from + 1 : 0;
}

/**
 * Calculate daily rate with 6 decimal precision (for prime periods)
 */
function calculateDailyRate(amount: number, daysInPeriod: number): number {
  return Math.round((amount / daysInPeriod) * 1000000) / 1000000;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

export const updateBudgetPeriodAmount = onCall<
  UpdateBudgetPeriodAmountRequest,
  Promise<UpdateBudgetPeriodAmountResponse>
>({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (request: CallableRequest<UpdateBudgetPeriodAmountRequest>) => {
  const { budgetPeriodId, newAmount, cascadeScope } = request.data;
  const warnings: string[] = [];

  try {
    // ========================================================================
    // VALIDATION
    // ========================================================================

    if (!budgetPeriodId) {
      throw new HttpsError('invalid-argument', 'budgetPeriodId is required');
    }

    if (newAmount === undefined || newAmount === null || isNaN(newAmount)) {
      throw new HttpsError('invalid-argument', 'newAmount must be a valid number');
    }

    if (newAmount < 0) {
      throw new HttpsError('invalid-argument', 'newAmount cannot be negative');
    }

    if (!cascadeScope || !['this_period', 'all_forward'].includes(cascadeScope)) {
      throw new HttpsError('invalid-argument', 'cascadeScope must be "this_period" or "all_forward"');
    }

    // ========================================================================
    // AUTHENTICATION
    // ========================================================================

    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const db = admin.firestore();

    console.log(`[updateBudgetPeriodAmount] User ${user.uid} updating period ${budgetPeriodId} to $${newAmount} (scope: ${cascadeScope})`);

    // ========================================================================
    // GET BUDGET PERIOD & BUDGET
    // ========================================================================

    const periodDoc = await db.collection('budget_periods').doc(budgetPeriodId).get();
    if (!periodDoc.exists) {
      throw new HttpsError('not-found', 'Budget period not found');
    }

    const period = { id: periodDoc.id, ...periodDoc.data() } as BudgetPeriodDocument;

    // Get the parent budget
    const budgetDoc = await db.collection('budgets').doc(period.budgetId).get();
    if (!budgetDoc.exists) {
      throw new HttpsError('not-found', 'Parent budget not found');
    }

    const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;

    // Ownership: the parent budget's CURRENT view (userId) — the caller's Me, or a group
    // they're in (Account-Rooted-Sharing PD6). Not createdBy, and no role bypass: every
    // user is an EDITOR, so a role check let anyone edit anyone's period. The admin SDK
    // skips rules, so this is the only guard.
    const owner_key = (budget as unknown as { userId?: string }).userId ?? '';
    const owner_gid = group_id_of_key(owner_key);
    const owner_group = owner_gid ? await group_repo.get(create_trace_context(false), owner_gid) : null;
    if (period.budgetId !== budget.id || !can_manage_budget(owner_key, user.uid, owner_group)) {
      throw new HttpsError('not-found', 'Budget period not found');
    }

    // Block past period updates
    if (isPastPeriod(period.periodEnd)) {
      throw new HttpsError('failed-precondition', 'Cannot edit past/historical periods. Only current and future periods can be modified.');
    }

    // Check for system budget
    if (budget.isSystemEverythingElse) {
      throw new HttpsError('failed-precondition', 'Cannot edit "Everything Else" system budget');
    }

    // Warn if new amount < spent (overspent)
    const spent = period.spent || 0;
    if (newAmount < spent) {
      warnings.push(`Warning: New amount ($${newAmount.toFixed(2)}) is less than spent ($${spent.toFixed(2)}). This will show as overspent.`);
    }

    // ========================================================================
    // DETERMINE PRIME PERIOD
    // ========================================================================

    // If editing a non-prime period, "This Period Only" edits the underlying prime.
    let targetPrimePeriodId = budgetPeriodId;
    let targetPrimePeriod = period;
    let primeAmount = newAmount;
    const budgetCadence = budget.period || "monthly";
    const editsOwnPeriod = isPrimePeriod(period, budgetCadence);

    // "All Periods Forward" sets the budget's NORMAL amount so the edited period, un-overridden,
    // gets exactly what was typed: amount ÷ the period's normal share of the budget — from the
    // CALENDAR (1 for the budget's own period; 7/31 for a week of a 31-day month; 31/7 for a month
    // of a weekly budget), never from stored period lists or one-off overrides.
    const share = editsOwnPeriod
      ? 1
      : budget_share_of_period(
        period.periodStart.toMillis(),
        period.periodEnd.toMillis(),
        budgetCadence
      );
    const forwardBudgetAmount =
      share && share > 0 ? Math.round((newAmount / share) * 100) / 100 : newAmount;

    if (!editsOwnPeriod && cascadeScope === "this_period") {
      // "This Period Only" on another period type: the same DOLLAR change lands on the budget's
      // own period this one overlaps most — never a past one (that would rewrite history).
      const ids = period.primePeriodIds ?? [];
      const primeDocs = await Promise.all(
        ids.map((id) => db.collection("budget_periods").doc(id).get())
      );
      let best: { doc: BudgetPeriodDocument; overlap: number } | null = null;
      for (const d of primeDocs) {
        if (!d.exists) continue;
        const pr = { id: d.id, ...d.data() } as BudgetPeriodDocument;
        if (isPastPeriod(pr.periodEnd)) continue;
        const overlap =
          overlapDays(period.periodStart, period.periodEnd, pr.periodStart, pr.periodEnd);
        if (overlap > 0 && (!best || overlap > best.overlap)) best = { doc: pr, overlap };
      }
      if (!best) {
        throw new HttpsError(
          "failed-precondition",
          "Change this amount from the budget's own period view."
        );
      }
      targetPrimePeriod = best.doc;
      targetPrimePeriodId = best.doc.id!;

      // The prime's current amount (its own override counts, even $0) is the base.
      const currentNonPrimeAmount = period.allocatedAmount;
      const currentPrimeAmount = period_allocation(targetPrimePeriod);
      primeAmount = Math.max(
        0,
        Math.round((currentPrimeAmount + (newAmount - (currentNonPrimeAmount || 0))) * 100) / 100
      );
      console.log(
        `[updateBudgetPeriodAmount] Non-prime "this period": prime ${targetPrimePeriodId} ` +
        `$${currentPrimeAmount} → $${primeAmount}`
      );
    } else if (!editsOwnPeriod) {
      console.log(
        `[updateBudgetPeriodAmount] Non-prime "all forward": share ${share?.toFixed(4)} → ` +
        `budget $${forwardBudgetAmount}`
      );
    }

    // ========================================================================
    // EXECUTE UPDATE
    // ========================================================================

    let periodsUpdated = 0;
    let budgetUpdated = false;

    if (cascadeScope === 'this_period') {
      periodsUpdated = await updateThisPeriodOnly(
        db,
        targetPrimePeriod,
        primeAmount,
        period.budgetId
      );
    } else {
      // 'all_forward'
      const result = await updateAllPeriodsForward(db, budget, forwardBudgetAmount);
      periodsUpdated = result.periodsUpdated;
      budgetUpdated = result.budgetUpdated;
    }

    console.log(`[updateBudgetPeriodAmount] ✓ Success: ${periodsUpdated} periods updated, budget updated: ${budgetUpdated}`);

    return {
      success: true,
      periodsUpdated,
      budgetUpdated,
      warnings,
    };

  } catch (error: any) {
    console.error('[updateBudgetPeriodAmount] Error:', error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError('internal', error.message || 'Failed to update budget period amount');
  }
});

// ============================================================================
// UPDATE STRATEGIES
// ============================================================================

/**
 * Update only the target period and cascade to non-primes that reference it
 */
async function updateThisPeriodOnly(
  db: admin.firestore.Firestore,
  targetPeriod: BudgetPeriodDocument,
  newAmount: number,
  budgetId: string
): Promise<number> {
  console.log(`[updateThisPeriodOnly] Updating period ${targetPeriod.id} to $${newAmount}`);

  // Get budget to determine period type for prime identification
  const budgetDoc = await db.collection('budgets').doc(budgetId).get();
  const budget = budgetDoc.exists ? budgetDoc.data() : null;
  const budgetPeriodType = budget?.period || 'monthly';

  return db.runTransaction(async (transaction) => {
    let updatedCount = 0;

    // Calculate new values for the target prime period
    const daysInPeriod = targetPeriod.daysInPeriod || getDaysInPeriod(targetPeriod.periodStart, targetPeriod.periodEnd);
    const newDailyRate = calculateDailyRate(newAmount, daysInPeriod);
    const spent = targetPeriod.spent || 0;
    const newRemaining = newAmount - spent;

    // Update the target period
    const targetRef = db.collection('budget_periods').doc(targetPeriod.id!);
    transaction.update(targetRef, {
      modifiedAmount: newAmount,
      isModified: true,
      dailyRate: newDailyRate,
      remaining: newRemaining,
      isPrime: true, // Ensure isPrime is set for consistency
      // Set directly by the user (a copy synced from another period carries this field; the
      // period page shows only a direct amount).
      modifiedAmountSyncedFrom: admin.firestore.FieldValue.delete(),
      lastModifiedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    updatedCount++;

    console.log(`[updateThisPeriodOnly] Updated prime: $${newAmount}, dailyRate: ${newDailyRate.toFixed(6)}, remaining: ${newRemaining}`);

    // Query ALL periods for this budget (not filtering by isPrime to handle legacy data)
    const allPeriodsQuery = await db.collection('budget_periods')
      .where('budgetId', '==', budgetId)
      .get();

    // Separate into primes and non-primes using period type matching
    const allPrimes: BudgetPeriodDocument[] = [];
    const nonPrimesToUpdate: admin.firestore.QueryDocumentSnapshot[] = [];

    const targetPrimeStart = targetPeriod.periodStart.toDate();
    const targetPrimeEnd = targetPeriod.periodEnd.toDate();

    for (const doc of allPeriodsQuery.docs) {
      const period = doc.data() as BudgetPeriodDocument;

      if (isPrimePeriod(period, budgetPeriodType)) {
        // This is a prime period
        if (doc.id === targetPeriod.id) {
          // Apply the pending update to the target prime for calculations
          allPrimes.push({
            ...period,
            id: doc.id,
            dailyRate: newDailyRate,
            modifiedAmount: newAmount,
            isModified: true,
          });
        } else {
          allPrimes.push({ ...period, id: doc.id });
        }
      } else {
        // This is a non-prime period - check if it overlaps with the updated prime
        const nonPrimeStart = period.periodStart.toDate();
        const nonPrimeEnd = period.periodEnd.toDate();

        // Check if this non-prime overlaps with the target prime's date range
        if (nonPrimeStart <= targetPrimeEnd && nonPrimeEnd >= targetPrimeStart) {
          nonPrimesToUpdate.push(doc);
        }
      }
    }

    // Sort primes by start date for SUMPRODUCT calculation
    allPrimes.sort((a, b) => a.periodStart.toMillis() - b.periodStart.toMillis());

    console.log(`[updateThisPeriodOnly] Found ${allPrimes.length} prime periods, ${nonPrimesToUpdate.length} non-prime periods to cascade`);

    // Update each non-prime period that overlaps with the updated prime
    for (const nonPrimeDoc of nonPrimesToUpdate) {
      const nonPrime = nonPrimeDoc.data() as BudgetPeriodDocument;

      // Find overlapping primes and recalculate using SUMPRODUCT
      const targetStart = nonPrime.periodStart.toDate();
      const targetEnd = nonPrime.periodEnd.toDate();

      const overlappingPrimes = findOverlappingPrimePeriods(targetStart, targetEnd, allPrimes);
      const { totalAmount, breakdown } = calculatePrimeContributions(targetStart, targetEnd, overlappingPrimes);

      const nonPrimeSpent = nonPrime.spent || 0;
      const nonPrimeRemaining = totalAmount - nonPrimeSpent;
      const nonPrimeDays = nonPrime.daysInPeriod || getDaysInPeriod(nonPrime.periodStart, nonPrime.periodEnd);
      const nonPrimeDailyRate = Math.round((totalAmount / nonPrimeDays) * 100) / 100; // 2 decimal for non-prime

      transaction.update(nonPrimeDoc.ref, {
        allocatedAmount: totalAmount,
        remaining: nonPrimeRemaining,
        dailyRate: nonPrimeDailyRate,
        primePeriodBreakdown: breakdown,
        primePeriodIds: overlappingPrimes.map(p => p.id!),
        isPrime: false, // Ensure isPrime is set for consistency
        updatedAt: Timestamp.now(),
        lastCalculated: Timestamp.now(),
      });
      updatedCount++;

      console.log(`[updateThisPeriodOnly] Updated non-prime ${nonPrimeDoc.id}: $${totalAmount.toFixed(2)} (SUMPRODUCT from ${overlappingPrimes.length} primes)`);
    }

    return updatedCount;
  });
}

/**
 * Normalize period type for comparison (handles string vs enum differences)
 */
function normalizePeriodType(periodType: string | PeriodType): string {
  if (!periodType) return '';
  return String(periodType).toLowerCase();
}

/**
 * Check if a period is a prime period (matches the budget's period type)
 * Prime periods are the "source of truth" for daily rates
 */
function isPrimePeriod(period: BudgetPeriodDocument, budgetPeriodType: string): boolean {
  // First check the explicit isPrime flag if set
  if (period.isPrime === true) return true;
  if (period.isPrime === false) return false;

  // Fall back to period type matching (for legacy data without isPrime)
  const normalizedPeriodType = normalizePeriodType(period.periodType);
  const normalizedBudgetType = normalizePeriodType(budgetPeriodType);
  return normalizedPeriodType === normalizedBudgetType;
}

/**
 * Update the budget base amount and all current + future periods
 */
async function updateAllPeriodsForward(
  db: admin.firestore.Firestore,
  budget: Budget,
  newBudgetAmount: number
): Promise<{ periodsUpdated: number; budgetUpdated: boolean }> {
  console.log(`[updateAllPeriodsForward] Updating budget ${budget.id} and all current/future periods`);

  // `newBudgetAmount` is the budget's new NORMAL amount (the caller converted the entered
  // period amount by that period's share of the budget); every current / future prime period
  // gets it, and their one-off "This Period Only" overrides are cleared.
  console.log(`[updateAllPeriodsForward] Budget amount: $${budget.amount} → $${newBudgetAmount}`);

  // Get budget period type - this determines what's "prime"
  // Prime periods match the budget's period type (e.g., monthly budget = monthly periods are prime)
  const budgetPeriodType = budget.period || 'monthly';

  console.log(`[updateAllPeriodsForward] Budget period type: ${budgetPeriodType}`);

  return db.runTransaction(async (transaction) => {
    let periodsUpdated = 0;

    // Update the budget document
    const budgetRef = db.collection('budgets').doc(budget.id!);
    transaction.update(budgetRef, {
      amount: newBudgetAmount,
      remaining: newBudgetAmount - (budget.spent || 0),
      updatedAt: Timestamp.now(),
    });

    // Query all periods for this budget
    const allPeriodsQuery = await db.collection('budget_periods')
      .where('budgetId', '==', budget.id)
      .get();

    // Separate into current/future primes and non-primes
    // Use period type matching to identify primes (not just isPrime field)
    const currentFuturePrimes: admin.firestore.QueryDocumentSnapshot[] = [];
    const currentFutureNonPrimes: admin.firestore.QueryDocumentSnapshot[] = [];

    for (const doc of allPeriodsQuery.docs) {
      const period = doc.data() as BudgetPeriodDocument;

      if (isCurrentOrFuturePeriod(period.periodEnd)) {
        // Use period type matching to correctly identify primes vs non-primes
        if (isPrimePeriod(period, budgetPeriodType)) {
          currentFuturePrimes.push(doc);
        } else {
          currentFutureNonPrimes.push(doc);
        }
      }
    }

    console.log(`[updateAllPeriodsForward] Current/future primes: ${currentFuturePrimes.length}, non-primes: ${currentFutureNonPrimes.length}`);

    // Update all current/future prime periods
    // Prime periods get the full budget amount for their period
    const updatedPrimes: BudgetPeriodDocument[] = [];

    for (const primeDoc of currentFuturePrimes) {
      const prime = primeDoc.data() as BudgetPeriodDocument;

      // Calculate new allocated amount based on new budget amount
      const daysInPeriod = prime.daysInPeriod || getDaysInPeriod(prime.periodStart, prime.periodEnd);

      // Prime periods get the full budget amount
      const newAllocatedAmount = newBudgetAmount;
      const newDailyRate = calculateDailyRate(newAllocatedAmount, daysInPeriod);
      const primeSpent = prime.spent || 0;
      const newRemaining = newAllocatedAmount - primeSpent;

      transaction.update(primeDoc.ref, {
        allocatedAmount: newAllocatedAmount,
        originalAmount: newAllocatedAmount,
        dailyRate: newDailyRate,
        remaining: newRemaining,
        modifiedAmount: null, // Clear any manual override
        isModified: false,
        isPrime: true, // Ensure isPrime is set for future consistency
        updatedAt: Timestamp.now(),
        lastCalculated: Timestamp.now(),
      });
      periodsUpdated++;

      console.log(`[updateAllPeriodsForward] Updated prime ${primeDoc.id}: $${newAllocatedAmount}, dailyRate: ${newDailyRate.toFixed(6)}`);

      // Track for non-prime recalculation
      updatedPrimes.push({
        ...prime,
        id: primeDoc.id,
        allocatedAmount: newAllocatedAmount,
        dailyRate: newDailyRate,
      });
    }

    // Update all current/future non-prime periods using SUMPRODUCT
    // Non-prime periods derive their amount from overlapping prime daily rates
    for (const nonPrimeDoc of currentFutureNonPrimes) {
      const nonPrime = nonPrimeDoc.data() as BudgetPeriodDocument;

      const targetStart = nonPrime.periodStart.toDate();
      const targetEnd = nonPrime.periodEnd.toDate();

      // Find overlapping primes and calculate using SUMPRODUCT (same as initial creation)
      const overlappingPrimes = findOverlappingPrimePeriods(targetStart, targetEnd, updatedPrimes);
      const { totalAmount, breakdown } = calculatePrimeContributions(targetStart, targetEnd, overlappingPrimes);

      const nonPrimeSpent = nonPrime.spent || 0;
      const nonPrimeRemaining = totalAmount - nonPrimeSpent;
      const nonPrimeDays = nonPrime.daysInPeriod || getDaysInPeriod(nonPrime.periodStart, nonPrime.periodEnd);
      const nonPrimeDailyRate = Math.round((totalAmount / nonPrimeDays) * 100) / 100;

      transaction.update(nonPrimeDoc.ref, {
        allocatedAmount: totalAmount,
        originalAmount: totalAmount,
        remaining: nonPrimeRemaining,
        dailyRate: nonPrimeDailyRate,
        primePeriodBreakdown: breakdown,
        primePeriodIds: overlappingPrimes.map(p => p.id!),
        modifiedAmount: null,
        isModified: false,
        isPrime: false, // Ensure isPrime is set for future consistency
        updatedAt: Timestamp.now(),
        lastCalculated: Timestamp.now(),
      });
      periodsUpdated++;

      console.log(`[updateAllPeriodsForward] Updated non-prime ${nonPrimeDoc.id}: $${totalAmount.toFixed(2)} (SUMPRODUCT from ${overlappingPrimes.length} primes)`);
    }

    console.log(`[updateAllPeriodsForward] ✓ Updated ${periodsUpdated} periods`);

    return {
      periodsUpdated,
      budgetUpdated: true,
    };
  });
}
