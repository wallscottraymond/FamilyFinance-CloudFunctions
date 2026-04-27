/**
 * Sync Notes to Overlapping Periods Utility
 *
 * When userNotes is updated on a budget_period, this utility syncs the notes
 * to all overlapping periods of OTHER budget types (same date range, different period type).
 *
 * Example:
 * - User adds note to Monthly period (2025-04-01 to 2025-04-30)
 * - Note syncs to overlapping Weekly periods (2025-W14, 2025-W15, etc.)
 * - Note syncs to overlapping Bi-Monthly periods (2025-BM04A, 2025-BM04B)
 *
 * Note: This syncs notes for the SAME BUDGET across different period types,
 * not across different budgets.
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriodDocument, PeriodType } from '../../../types';

export interface NoteSyncResult {
  success: boolean;
  periodsQueried: number;
  periodsUpdated: number;
  periodTypes: string[];
  errors: string[];
}

/**
 * Get all period types except the source period's type
 */
function getOtherPeriodTypes(sourcePeriodType: PeriodType): PeriodType[] {
  const allTypes = [PeriodType.MONTHLY, PeriodType.WEEKLY, PeriodType.BI_MONTHLY];
  return allTypes.filter(type => type !== sourcePeriodType);
}

/**
 * Check if two date ranges overlap
 * Two periods overlap if: periodA.start <= periodB.end AND periodA.end >= periodB.start
 */
function periodsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date
): boolean {
  return aStart <= bEnd && aEnd >= bStart;
}

/**
 * Sync notes from one budget period to all overlapping periods of other types
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period that was updated with new notes
 * @param newNotes - The new notes value to sync
 * @returns Result with sync statistics
 */
export async function syncNotesToOverlappingPeriods(
  db: admin.firestore.Firestore,
  sourcePeriod: BudgetPeriodDocument,
  newNotes: string | undefined
): Promise<NoteSyncResult> {
  const result: NoteSyncResult = {
    success: false,
    periodsQueried: 0,
    periodsUpdated: 0,
    periodTypes: [],
    errors: []
  };

  try {
    console.log('[syncNotesToOverlappingPeriods] ════════════════════════════════════════════');
    console.log('[syncNotesToOverlappingPeriods] SYNCING NOTES TO OVERLAPPING PERIODS');
    console.log('[syncNotesToOverlappingPeriods] ════════════════════════════════════════════');
    console.log(`[syncNotesToOverlappingPeriods] Source period: ${sourcePeriod.id}`);
    console.log(`[syncNotesToOverlappingPeriods] Source type: ${sourcePeriod.periodType}`);
    console.log(`[syncNotesToOverlappingPeriods] Budget ID: ${sourcePeriod.budgetId}`);
    console.log(`[syncNotesToOverlappingPeriods] Notes: "${newNotes?.substring(0, 50)}${(newNotes?.length || 0) > 50 ? '...' : ''}"`);

    const sourceStart = sourcePeriod.periodStart.toDate();
    const sourceEnd = sourcePeriod.periodEnd.toDate();
    const otherTypes = getOtherPeriodTypes(sourcePeriod.periodType);

    console.log(`[syncNotesToOverlappingPeriods] Looking for overlapping periods of types: ${otherTypes.join(', ')}`);

    // Query all periods of other types for the same budget
    const periodsSnapshot = await db.collection('budget_periods')
      .where('budgetId', '==', sourcePeriod.budgetId)
      .where('periodType', 'in', otherTypes)
      .get();

    result.periodsQueried = periodsSnapshot.size;
    console.log(`[syncNotesToOverlappingPeriods] Found ${periodsSnapshot.size} periods of other types`);

    if (periodsSnapshot.empty) {
      console.log('[syncNotesToOverlappingPeriods] No other period types found for this budget');
      result.success = true;
      return result;
    }

    // Find overlapping periods and update their notes
    const batch = db.batch();
    let updatedCount = 0;
    const updatedTypes = new Set<string>();

    for (const periodDoc of periodsSnapshot.docs) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const periodStart = period.periodStart.toDate();
      const periodEnd = period.periodEnd.toDate();

      // Check if this period overlaps with the source period
      if (periodsOverlap(sourceStart, sourceEnd, periodStart, periodEnd)) {
        // Skip if notes are already the same
        if (period.userNotes === newNotes) {
          console.log(`[syncNotesToOverlappingPeriods] Period ${periodDoc.id} already has same notes, skipping`);
          continue;
        }

        batch.update(periodDoc.ref, {
          userNotes: newNotes || null,
          updatedAt: Timestamp.now(),
          notesSyncedFrom: sourcePeriod.id,
          notesSyncedAt: Timestamp.now()
        });

        updatedCount++;
        updatedTypes.add(String(period.periodType));
        console.log(`[syncNotesToOverlappingPeriods] Syncing to period ${periodDoc.id} (${period.periodType})`);
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
      result.periodsUpdated = updatedCount;
      result.periodTypes = Array.from(updatedTypes);
      console.log(`[syncNotesToOverlappingPeriods] ✓ Synced notes to ${updatedCount} periods`);
    } else {
      console.log('[syncNotesToOverlappingPeriods] No overlapping periods needed update');
    }

    result.success = true;
    console.log('[syncNotesToOverlappingPeriods] ════════════════════════════════════════════');

  } catch (error: any) {
    console.error('[syncNotesToOverlappingPeriods] Error:', error);
    result.errors.push(error.message || 'Unknown error');
  }

  return result;
}

/**
 * Sync checklist items to overlapping periods
 * Similar to notes sync, but for checklistItems array
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period that was updated
 * @param newChecklistItems - The new checklist items to sync
 * @returns Result with sync statistics
 */
export async function syncChecklistToOverlappingPeriods(
  db: admin.firestore.Firestore,
  sourcePeriod: BudgetPeriodDocument,
  newChecklistItems: any[]
): Promise<NoteSyncResult> {
  const result: NoteSyncResult = {
    success: false,
    periodsQueried: 0,
    periodsUpdated: 0,
    periodTypes: [],
    errors: []
  };

  try {
    console.log('[syncChecklistToOverlappingPeriods] Syncing checklist items');
    console.log(`[syncChecklistToOverlappingPeriods] Source period: ${sourcePeriod.id}`);
    console.log(`[syncChecklistToOverlappingPeriods] Items count: ${newChecklistItems?.length || 0}`);

    const sourceStart = sourcePeriod.periodStart.toDate();
    const sourceEnd = sourcePeriod.periodEnd.toDate();
    const otherTypes = getOtherPeriodTypes(sourcePeriod.periodType);

    // Query all periods of other types for the same budget
    const periodsSnapshot = await db.collection('budget_periods')
      .where('budgetId', '==', sourcePeriod.budgetId)
      .where('periodType', 'in', otherTypes)
      .get();

    result.periodsQueried = periodsSnapshot.size;

    if (periodsSnapshot.empty) {
      result.success = true;
      return result;
    }

    const batch = db.batch();
    let updatedCount = 0;
    const updatedTypes = new Set<string>();

    for (const periodDoc of periodsSnapshot.docs) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const periodStart = period.periodStart.toDate();
      const periodEnd = period.periodEnd.toDate();

      if (periodsOverlap(sourceStart, sourceEnd, periodStart, periodEnd)) {
        batch.update(periodDoc.ref, {
          checklistItems: newChecklistItems || [],
          updatedAt: Timestamp.now(),
          checklistSyncedFrom: sourcePeriod.id,
          checklistSyncedAt: Timestamp.now()
        });

        updatedCount++;
        updatedTypes.add(String(period.periodType));
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
      result.periodsUpdated = updatedCount;
      result.periodTypes = Array.from(updatedTypes);
    }

    result.success = true;

  } catch (error: any) {
    console.error('[syncChecklistToOverlappingPeriods] Error:', error);
    result.errors.push(error.message || 'Unknown error');
  }

  return result;
}

/**
 * Sync modifiedAmount to overlapping periods
 * When a user modifies the allocated amount for a specific period,
 * sync that modification to overlapping periods of other types
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period with the modified amount
 * @param newModifiedAmount - The new modified amount
 * @returns Result with sync statistics
 */
export async function syncModifiedAmountToOverlappingPeriods(
  db: admin.firestore.Firestore,
  sourcePeriod: BudgetPeriodDocument,
  newModifiedAmount: number | undefined
): Promise<NoteSyncResult> {
  const result: NoteSyncResult = {
    success: false,
    periodsQueried: 0,
    periodsUpdated: 0,
    periodTypes: [],
    errors: []
  };

  try {
    console.log('[syncModifiedAmountToOverlappingPeriods] Syncing modified amount');
    console.log(`[syncModifiedAmountToOverlappingPeriods] Source period: ${sourcePeriod.id}`);
    console.log(`[syncModifiedAmountToOverlappingPeriods] Modified amount: $${newModifiedAmount?.toFixed(2) || 'none'}`);

    const sourceStart = sourcePeriod.periodStart.toDate();
    const sourceEnd = sourcePeriod.periodEnd.toDate();
    const otherTypes = getOtherPeriodTypes(sourcePeriod.periodType);

    const periodsSnapshot = await db.collection('budget_periods')
      .where('budgetId', '==', sourcePeriod.budgetId)
      .where('periodType', 'in', otherTypes)
      .get();

    result.periodsQueried = periodsSnapshot.size;

    if (periodsSnapshot.empty) {
      result.success = true;
      return result;
    }

    const batch = db.batch();
    let updatedCount = 0;
    const updatedTypes = new Set<string>();

    for (const periodDoc of periodsSnapshot.docs) {
      const period = periodDoc.data() as BudgetPeriodDocument;
      const periodStart = period.periodStart.toDate();
      const periodEnd = period.periodEnd.toDate();

      if (periodsOverlap(sourceStart, sourceEnd, periodStart, periodEnd)) {
        const updates: any = {
          isModified: newModifiedAmount !== undefined,
          updatedAt: Timestamp.now(),
          modifiedAmountSyncedFrom: sourcePeriod.id,
          modifiedAmountSyncedAt: Timestamp.now()
        };

        if (newModifiedAmount !== undefined) {
          // Calculate proportional amount for the overlapping period based on day coverage
          // For simplicity, we'll use the same modified amount
          // A more sophisticated approach would prorate based on overlap days
          updates.modifiedAmount = newModifiedAmount;
        } else {
          updates.modifiedAmount = admin.firestore.FieldValue.delete();
        }

        batch.update(periodDoc.ref, updates);
        updatedCount++;
        updatedTypes.add(String(period.periodType));
      }
    }

    if (updatedCount > 0) {
      await batch.commit();
      result.periodsUpdated = updatedCount;
      result.periodTypes = Array.from(updatedTypes);
    }

    result.success = true;

  } catch (error: any) {
    console.error('[syncModifiedAmountToOverlappingPeriods] Error:', error);
    result.errors.push(error.message || 'Unknown error');
  }

  return result;
}
