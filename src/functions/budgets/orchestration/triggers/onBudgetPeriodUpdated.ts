/**
 * Budget Period Update Trigger
 *
 * Handles budget_period document updates, specifically:
 * - Syncing userNotes to overlapping periods of other types
 * - Syncing checklistItems to overlapping periods
 * - Syncing modifiedAmount to overlapping periods
 *
 * This ensures that user-entered data is consistent across all
 * period views (monthly, weekly, bi-monthly) for the same budget.
 *
 * Memory: 256MiB (lightweight sync operations)
 * Timeout: 30s
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from 'firebase-admin';
import { BudgetPeriodDocument } from "../../../../types";
import {
  syncNotesToOverlappingPeriods,
  syncChecklistToOverlappingPeriods,
  syncModifiedAmountToOverlappingPeriods
} from "../../utils/syncNotesToOverlappingPeriods";
import { handleBudgetPeriodPauseResume } from "../../utils/handleBudgetPeriodPauseResume";

/**
 * Trigger: Sync budget period changes to overlapping periods
 *
 * Fires when a budget_period document is updated. Detects changes to
 * userNotes, checklistItems, and modifiedAmount and syncs them
 * to overlapping periods of other types.
 */
export const onBudgetPeriodUpdated = onDocumentUpdated({
  document: "budget_periods/{periodId}",
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30
}, async (event) => {
  try {
    const periodId = event.params.periodId;
    const beforeData = event.data?.before.data() as BudgetPeriodDocument | undefined;
    const afterData = event.data?.after.data() as BudgetPeriodDocument | undefined;

    if (!beforeData || !afterData) {
      console.error("[onBudgetPeriodUpdated] Missing before or after data");
      return;
    }

    // Skip if this is a synced update (prevent infinite loop)
    const beforeSyncedAt = (beforeData as any).notesSyncedAt?.toMillis?.() ?? 0;
    const afterSyncedAt = (afterData as any).notesSyncedAt?.toMillis?.() ?? 0;
    const beforeChecklistSyncedAt = (beforeData as any).checklistSyncedAt?.toMillis?.() ?? 0;
    const afterChecklistSyncedAt = (afterData as any).checklistSyncedAt?.toMillis?.() ?? 0;
    const beforeModifiedSyncedAt = (beforeData as any).modifiedAmountSyncedAt?.toMillis?.() ?? 0;
    const afterModifiedSyncedAt = (afterData as any).modifiedAmountSyncedAt?.toMillis?.() ?? 0;

    // If any sync timestamp changed, this is a cascaded update - skip to prevent loop
    if (afterSyncedAt > beforeSyncedAt ||
        afterChecklistSyncedAt > beforeChecklistSyncedAt ||
        afterModifiedSyncedAt > beforeModifiedSyncedAt) {
      console.log(`[onBudgetPeriodUpdated] Skipping cascaded sync update for period: ${periodId}`);
      return;
    }

    // Detect what changed
    const notesChanged = beforeData.userNotes !== afterData.userNotes;
    const checklistChanged = JSON.stringify((beforeData as any).checklistItems || []) !==
                             JSON.stringify((afterData as any).checklistItems || []);
    const modifiedAmountChanged = (beforeData as any).modifiedAmount !== (afterData as any).modifiedAmount ||
                                  beforeData.isModified !== afterData.isModified;
    const isActiveChanged = beforeData.isActive !== afterData.isActive;

    // Skip if nothing we care about changed
    if (!notesChanged && !checklistChanged && !modifiedAmountChanged && !isActiveChanged) {
      return;
    }

    console.log('');
    console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
    console.log('[onBudgetPeriodUpdated] BUDGET PERIOD UPDATED - SYNC CHECK');
    console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
    console.log(`[onBudgetPeriodUpdated] Period ID: ${periodId}`);
    console.log(`[onBudgetPeriodUpdated] Budget ID: ${afterData.budgetId}`);
    console.log(`[onBudgetPeriodUpdated] Period Type: ${afterData.periodType}`);
    console.log(`[onBudgetPeriodUpdated] Notes changed: ${notesChanged}`);
    console.log(`[onBudgetPeriodUpdated] Checklist changed: ${checklistChanged}`);
    console.log(`[onBudgetPeriodUpdated] Modified amount changed: ${modifiedAmountChanged}`);
    console.log(`[onBudgetPeriodUpdated] isActive changed: ${isActiveChanged} (${beforeData.isActive} → ${afterData.isActive})`);
    console.log('');

    // Initialize Firestore
    const db = admin.firestore();

    // Build source period object with id included
    const sourcePeriod: BudgetPeriodDocument = {
      ...afterData,
      id: periodId
    };

    // Sync notes if changed
    if (notesChanged) {
      console.log('[onBudgetPeriodUpdated] Syncing notes to overlapping periods...');
      const notesResult = await syncNotesToOverlappingPeriods(
        db,
        sourcePeriod,
        afterData.userNotes
      );

      if (notesResult.success) {
        console.log(`[onBudgetPeriodUpdated] ✓ Notes synced to ${notesResult.periodsUpdated} periods`);
      } else {
        console.error(`[onBudgetPeriodUpdated] ⚠️  Notes sync errors: ${notesResult.errors.join(', ')}`);
      }
    }

    // Sync checklist if changed
    if (checklistChanged) {
      console.log('[onBudgetPeriodUpdated] Syncing checklist to overlapping periods...');
      const checklistResult = await syncChecklistToOverlappingPeriods(
        db,
        sourcePeriod,
        (afterData as any).checklistItems || []
      );

      if (checklistResult.success) {
        console.log(`[onBudgetPeriodUpdated] ✓ Checklist synced to ${checklistResult.periodsUpdated} periods`);
      } else {
        console.error(`[onBudgetPeriodUpdated] ⚠️  Checklist sync errors: ${checklistResult.errors.join(', ')}`);
      }
    }

    // Sync modified amount if changed
    if (modifiedAmountChanged) {
      console.log('[onBudgetPeriodUpdated] Syncing modified amount to overlapping periods...');
      const modifiedResult = await syncModifiedAmountToOverlappingPeriods(
        db,
        sourcePeriod,
        (afterData as any).modifiedAmount
      );

      if (modifiedResult.success) {
        console.log(`[onBudgetPeriodUpdated] ✓ Modified amount synced to ${modifiedResult.periodsUpdated} periods`);
      } else {
        console.error(`[onBudgetPeriodUpdated] ⚠️  Modified amount sync errors: ${modifiedResult.errors.join(', ')}`);
      }
    }

    // Handle isActive change (pause/resume)
    if (isActiveChanged) {
      const isPausing = beforeData.isActive === true && afterData.isActive === false;
      console.log(`[onBudgetPeriodUpdated] ${isPausing ? 'PAUSING' : 'RESUMING'} budget period...`);

      const pauseResumeResult = await handleBudgetPeriodPauseResume(
        db,
        periodId,
        afterData,
        isPausing
      );

      if (pauseResumeResult.success) {
        console.log(`[onBudgetPeriodUpdated] ✓ ${pauseResumeResult.action}: ${pauseResumeResult.message}`);
      } else {
        console.error(`[onBudgetPeriodUpdated] ⚠️ Pause/resume error: ${pauseResumeResult.error}`);
      }
    }

    console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
    console.log('[onBudgetPeriodUpdated] SYNC COMPLETE');
    console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[onBudgetPeriodUpdated] ❌ CRITICAL ERROR:', error);
    console.error('');
    // Don't throw - we don't want to break period updates if sync fails
  }
});
