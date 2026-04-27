/**
 * Handle Budget Date Changes Utility
 *
 * Manages period adjustments when budget date-related fields change:
 * - startDate: May add/remove periods at the beginning
 * - isOngoing: Changes from ongoing to limited or vice versa
 * - budgetEndDate: Sets when a budget should stop
 *
 * Strategy:
 * - Periods BEFORE new startDate → Mark inactive (preserve for history)
 * - Periods AFTER budgetEndDate → Mark inactive (preserve for history)
 * - Gaps in coverage → Generate new periods
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { Budget, BudgetPeriodDocument } from '../../../types';
// Note: generateBudgetPeriodsWithPrimeSystem will be used when gap period generation is implemented

export interface DateChangeResult {
  success: boolean;
  startDateChange: {
    detected: boolean;
    periodsDeactivated: number;
    periodsGenerated: number;
  };
  endDateChange: {
    detected: boolean;
    periodsDeactivated: number;
    periodsReactivated: number;
  };
  errors: string[];
}

// Note: getTodayUTC will be used when we need to filter periods relative to today
// function getTodayUTC(): Date {
//   const now = new Date();
//   return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
// }

/**
 * Check if startDate changed
 */
function hasStartDateChanged(before: Budget, after: Budget): boolean {
  const beforeStart = before.startDate?.toMillis?.() ?? null;
  const afterStart = after.startDate?.toMillis?.() ?? null;
  return beforeStart !== afterStart;
}

/**
 * Check if end date configuration changed (isOngoing or budgetEndDate)
 */
function hasEndDateConfigChanged(before: Budget, after: Budget): boolean {
  // Check isOngoing change
  if (before.isOngoing !== after.isOngoing) {
    return true;
  }

  // Check budgetEndDate change
  const beforeEnd = before.budgetEndDate?.toMillis?.() ?? null;
  const afterEnd = after.budgetEndDate?.toMillis?.() ?? null;
  return beforeEnd !== afterEnd;
}

/**
 * Main function: Handle budget date-related changes
 *
 * @param db - Firestore instance
 * @param budgetId - The budget ID
 * @param budgetBefore - Budget data before update
 * @param budgetAfter - Budget data after update
 * @returns Result with change statistics
 */
export async function handleBudgetDateChanges(
  db: admin.firestore.Firestore,
  budgetId: string,
  budgetBefore: Budget,
  budgetAfter: Budget
): Promise<DateChangeResult> {
  const result: DateChangeResult = {
    success: false,
    startDateChange: {
      detected: false,
      periodsDeactivated: 0,
      periodsGenerated: 0
    },
    endDateChange: {
      detected: false,
      periodsDeactivated: 0,
      periodsReactivated: 0
    },
    errors: []
  };

  try {
    const startDateChanged = hasStartDateChanged(budgetBefore, budgetAfter);
    const endDateConfigChanged = hasEndDateConfigChanged(budgetBefore, budgetAfter);

    if (!startDateChanged && !endDateConfigChanged) {
      console.log('[handleBudgetDateChanges] No date-related changes detected');
      result.success = true;
      return result;
    }

    console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');
    console.log('[handleBudgetDateChanges] DATE CHANGES DETECTED');
    console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');

    // Query all existing periods for this budget
    const periodsSnapshot = await db.collection('budget_periods')
      .where('budgetId', '==', budgetId)
      .get();

    console.log(`[handleBudgetDateChanges] Found ${periodsSnapshot.size} existing periods`);

    // Handle startDate changes
    if (startDateChanged) {
      result.startDateChange.detected = true;
      await handleStartDateChange(
        db,
        budgetId,
        budgetBefore,
        budgetAfter,
        periodsSnapshot.docs,
        result
      );
    }

    // Handle endDate/isOngoing changes
    if (endDateConfigChanged) {
      result.endDateChange.detected = true;
      await handleEndDateChange(
        db,
        budgetId,
        budgetBefore,
        budgetAfter,
        periodsSnapshot.docs,
        result
      );
    }

    result.success = true;
    console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');
    console.log('[handleBudgetDateChanges] DATE CHANGES COMPLETE');
    console.log(`[handleBudgetDateChanges] Start: deactivated=${result.startDateChange.periodsDeactivated}, generated=${result.startDateChange.periodsGenerated}`);
    console.log(`[handleBudgetDateChanges] End: deactivated=${result.endDateChange.periodsDeactivated}, reactivated=${result.endDateChange.periodsReactivated}`);
    console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');

  } catch (error: any) {
    console.error('[handleBudgetDateChanges] Error:', error);
    result.errors.push(error.message || 'Unknown error');
  }

  return result;
}

/**
 * Handle startDate changes
 *
 * - If startDate moved LATER: Deactivate periods before new startDate
 * - If startDate moved EARLIER: Generate new periods for the gap
 */
async function handleStartDateChange(
  db: admin.firestore.Firestore,
  budgetId: string,
  budgetBefore: Budget,
  budgetAfter: Budget,
  existingPeriods: admin.firestore.QueryDocumentSnapshot[],
  result: DateChangeResult
): Promise<void> {
  const beforeStart = budgetBefore.startDate?.toDate() || new Date();
  const afterStart = budgetAfter.startDate?.toDate() || new Date();

  console.log(`[handleBudgetDateChanges] startDate: ${beforeStart.toISOString()} → ${afterStart.toISOString()}`);

  if (afterStart > beforeStart) {
    // StartDate moved LATER - deactivate periods before new startDate
    console.log('[handleBudgetDateChanges] startDate moved later, deactivating early periods');

    const batch = db.batch();
    let deactivatedCount = 0;

    for (const periodDoc of existingPeriods) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const periodEnd = period.periodEnd.toDate();

      // If period ends before new startDate, deactivate it
      if (periodEnd < afterStart) {
        batch.update(periodDoc.ref, {
          isActive: false,
          updatedAt: Timestamp.now(),
          deactivationReason: 'startDate_moved_later'
        });
        deactivatedCount++;
      }
    }

    if (deactivatedCount > 0) {
      await batch.commit();
      result.startDateChange.periodsDeactivated = deactivatedCount;
      console.log(`[handleBudgetDateChanges] Deactivated ${deactivatedCount} periods before new startDate`);
    }

  } else if (afterStart < beforeStart) {
    // StartDate moved EARLIER - need to generate periods for the gap
    console.log('[handleBudgetDateChanges] startDate moved earlier, generating new periods');

    // Find the earliest existing period
    let earliestPeriodStart: Date | null = null;
    for (const periodDoc of existingPeriods) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const periodStart = period.periodStart.toDate();
      if (!earliestPeriodStart || periodStart < earliestPeriodStart) {
        earliestPeriodStart = periodStart;
      }
    }

    if (earliestPeriodStart && afterStart < earliestPeriodStart) {
      // Generate periods from new startDate to just before earliest existing period
      console.log(`[handleBudgetDateChanges] Generating periods from ${afterStart.toISOString()} to ${earliestPeriodStart.toISOString()}`);

      // Calculate end date for new periods (day before earliest existing)
      const gapEndDate = new Date(earliestPeriodStart);
      gapEndDate.setDate(gapEndDate.getDate() - 1);

      // TODO: Implement selective period generation for date range
      // This would need to call generateBudgetPeriodsWithPrimeSystem with specific date range
      // For now, we just log that this should happen
      console.log(`[handleBudgetDateChanges] Would generate periods for gap: ${afterStart.toISOString()} to ${gapEndDate.toISOString()}`);
      // result.startDateChange.periodsGenerated = generatedCount;
    }
  }
}

/**
 * Handle endDate/isOngoing changes
 *
 * - If changing to limited (isOngoing=false with budgetEndDate): Deactivate periods after endDate
 * - If changing to ongoing (isOngoing=true): Reactivate periods that were deactivated due to endDate
 * - If budgetEndDate changed: Adjust which periods are active/inactive
 */
async function handleEndDateChange(
  db: admin.firestore.Firestore,
  budgetId: string,
  budgetBefore: Budget,
  budgetAfter: Budget,
  existingPeriods: admin.firestore.QueryDocumentSnapshot[],
  result: DateChangeResult
): Promise<void> {
  const wasOngoing = budgetBefore.isOngoing ?? true;
  const isNowOngoing = budgetAfter.isOngoing ?? true;
  const oldEndDate = budgetBefore.budgetEndDate?.toDate();
  const newEndDate = budgetAfter.budgetEndDate?.toDate();

  console.log(`[handleBudgetDateChanges] isOngoing: ${wasOngoing} → ${isNowOngoing}`);
  console.log(`[handleBudgetDateChanges] budgetEndDate: ${oldEndDate?.toISOString() || 'none'} → ${newEndDate?.toISOString() || 'none'}`);

  const batch = db.batch();
  let deactivatedCount = 0;
  let reactivatedCount = 0;

  if (!isNowOngoing && newEndDate) {
    // Budget is now limited - deactivate periods after endDate
    console.log('[handleBudgetDateChanges] Budget now has end date, checking for periods to deactivate');

    for (const periodDoc of existingPeriods) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const periodStart = period.periodStart.toDate();

      // If period starts after the budget end date, deactivate it
      if (periodStart > newEndDate) {
        // Only deactivate if currently active
        if (period.isActive !== false) {
          batch.update(periodDoc.ref, {
            isActive: false,
            updatedAt: Timestamp.now(),
            deactivationReason: 'budget_end_date_reached'
          });
          deactivatedCount++;
        }
      }
    }

  } else if (isNowOngoing && !wasOngoing) {
    // Budget changed from limited to ongoing - reactivate periods that were deactivated due to endDate
    console.log('[handleBudgetDateChanges] Budget now ongoing, checking for periods to reactivate');

    for (const periodDoc of existingPeriods) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const deactivationReason = (period as any).deactivationReason;

      // Reactivate periods that were deactivated due to budget end date
      if (period.isActive === false && deactivationReason === 'budget_end_date_reached') {
        batch.update(periodDoc.ref, {
          isActive: true,
          updatedAt: Timestamp.now(),
          deactivationReason: admin.firestore.FieldValue.delete()
        });
        reactivatedCount++;
      }
    }

  } else if (!isNowOngoing && newEndDate && oldEndDate) {
    // budgetEndDate changed - adjust which periods are active
    console.log('[handleBudgetDateChanges] Budget end date changed, adjusting period status');

    for (const periodDoc of existingPeriods) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const periodStart = period.periodStart.toDate();
      const deactivationReason = (period as any).deactivationReason;

      if (periodStart > newEndDate) {
        // Should be inactive
        if (period.isActive !== false) {
          batch.update(periodDoc.ref, {
            isActive: false,
            updatedAt: Timestamp.now(),
            deactivationReason: 'budget_end_date_reached'
          });
          deactivatedCount++;
        }
      } else {
        // Should be active (if it was deactivated due to end date)
        if (period.isActive === false && deactivationReason === 'budget_end_date_reached') {
          batch.update(periodDoc.ref, {
            isActive: true,
            updatedAt: Timestamp.now(),
            deactivationReason: admin.firestore.FieldValue.delete()
          });
          reactivatedCount++;
        }
      }
    }
  }

  if (deactivatedCount > 0 || reactivatedCount > 0) {
    await batch.commit();
    result.endDateChange.periodsDeactivated = deactivatedCount;
    result.endDateChange.periodsReactivated = reactivatedCount;
    console.log(`[handleBudgetDateChanges] End date changes: deactivated=${deactivatedCount}, reactivated=${reactivatedCount}`);
  }
}
