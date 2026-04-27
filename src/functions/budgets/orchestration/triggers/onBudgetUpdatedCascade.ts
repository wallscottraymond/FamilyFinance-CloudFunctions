/**
 * Budget Update Cascade Trigger
 *
 * Cascades budget field changes to budget_periods.
 * Handles: name, amount, description, alertThreshold changes.
 *
 * This trigger complements onBudgetUpdatedReassignTransactions which
 * handles categoryIds changes (transaction reassignment).
 *
 * Update Strategy:
 * - Changes cascade to current + future periods only
 * - Historical periods (periodEnd < today) are preserved
 * - Uses the same pattern as inflows/outflows
 *
 * Memory: 512MiB (for batch operations)
 * Timeout: 60s
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from 'firebase-admin';
import { Budget } from "../../../../types";
import { runUpdateBudgetPeriods } from "../../utils/runUpdateBudgetPeriods";
import { redistributeBudgetAllocation } from "../../utils/redistributeBudgetAllocation";
import { handleBudgetDateChanges } from "../../utils/handleBudgetDateChanges";

/**
 * Trigger: Cascade budget field changes to budget_periods
 *
 * Fires when a budget document is updated. Detects changes to
 * name, amount, description, alertThreshold and cascades them
 * to current + future budget_periods.
 */
export const onBudgetUpdatedCascade = onDocumentUpdated({
  document: "budgets/{budgetId}",
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 60
}, async (event) => {
  try {
    const budgetId = event.params.budgetId;
    const beforeData = event.data?.before.data() as Budget | undefined;
    const afterData = event.data?.after.data() as Budget | undefined;

    if (!beforeData || !afterData) {
      console.error("[onBudgetUpdatedCascade] Missing before or after data");
      return;
    }

    console.log('');
    console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
    console.log('[onBudgetUpdatedCascade] BUDGET UPDATED - CHECKING FOR CASCADE');
    console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
    console.log(`[onBudgetUpdatedCascade] Budget ID: ${budgetId}`);
    console.log(`[onBudgetUpdatedCascade] Name: ${afterData.name}`);
    console.log(`[onBudgetUpdatedCascade] isActive: ${afterData.isActive}`);
    console.log('');

    // Initialize Firestore
    const db = admin.firestore();

    // Handle isActive changes (pause/resume) FIRST before any early returns
    // This only affects the CURRENT period, not all periods
    if (beforeData.isActive !== afterData.isActive) {
      console.log('');
      console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
      console.log('[onBudgetUpdatedCascade] BUDGET isActive CHANGED - REDISTRIBUTION');
      console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
      console.log(`[onBudgetUpdatedCascade] isActive: ${beforeData.isActive} → ${afterData.isActive}`);

      // Don't redistribute if this is a system "Everything Else" budget
      if (afterData.isSystemEverythingElse) {
        console.log(`[onBudgetUpdatedCascade] Skipping redistribution for system budget`);
      } else {
        // Get userId from budget (supports both patterns)
        const userId = afterData.userId || afterData.access?.createdBy;
        if (!userId) {
          console.error(`[onBudgetUpdatedCascade] No userId found on budget`);
        } else {
          const isPausing = !afterData.isActive;
          const redistributionResult = await redistributeBudgetAllocation(
            db,
            budgetId,
            userId,
            isPausing
          );

          if (redistributionResult.success) {
            console.log(`[onBudgetUpdatedCascade] ✓ Redistribution ${redistributionResult.action}`);
            console.log(`[onBudgetUpdatedCascade] ✓ Amount: $${redistributionResult.amountRedistributed.toFixed(2)}`);
            console.log(`[onBudgetUpdatedCascade] ✓ Budget Period: ${redistributionResult.budgetPeriodId}`);
            console.log(`[onBudgetUpdatedCascade] ✓ Everything Else Period: ${redistributionResult.everythingElsePeriodId}`);
          } else {
            console.error(`[onBudgetUpdatedCascade] ⚠️  Redistribution failed: ${redistributionResult.error}`);
          }
        }
      }

      console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
      console.log('');
    }

    // Skip field cascade if budget is now inactive (only redistribution matters)
    if (!afterData.isActive) {
      console.log(`[onBudgetUpdatedCascade] Skipping field cascade for inactive budget: ${budgetId}`);
      return;
    }

    // Run the update cascade logic
    console.log('[onBudgetUpdatedCascade] Calling runUpdateBudgetPeriods...');
    const result = await runUpdateBudgetPeriods(
      db,
      budgetId,
      beforeData,
      afterData
    );

    console.log('');
    console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
    console.log('[onBudgetUpdatedCascade] CASCADE COMPLETE');
    console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');

    if (result.fieldsUpdated.length === 0) {
      console.log(`[onBudgetUpdatedCascade] No cascade-able changes detected`);
    } else {
      console.log(`[onBudgetUpdatedCascade] ✓ Fields changed: ${result.fieldsUpdated.join(', ')}`);
      console.log(`[onBudgetUpdatedCascade] ✓ Periods queried: ${result.periodsQueried}`);
      console.log(`[onBudgetUpdatedCascade] ✓ Periods updated: ${result.periodsUpdated}`);
      console.log(`[onBudgetUpdatedCascade] ✓ Periods skipped (historical): ${result.periodsSkipped}`);
    }

    if (result.errors.length > 0) {
      console.log(`[onBudgetUpdatedCascade] ⚠️  Errors encountered: ${result.errors.length}`);
      result.errors.forEach((err, idx) => {
        console.log(`[onBudgetUpdatedCascade]    ${idx + 1}. ${err}`);
      });
    }

    console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
    console.log('');

    // Handle date-related changes (startDate, isOngoing, budgetEndDate)
    const dateChangeResult = await handleBudgetDateChanges(db, budgetId, beforeData, afterData);

    if (dateChangeResult.startDateChange.detected || dateChangeResult.endDateChange.detected) {
      console.log('');
      console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
      console.log('[onBudgetUpdatedCascade] DATE CHANGE HANDLING COMPLETE');
      console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
      if (dateChangeResult.startDateChange.detected) {
        console.log(`[onBudgetUpdatedCascade] ✓ Start date: deactivated=${dateChangeResult.startDateChange.periodsDeactivated}, generated=${dateChangeResult.startDateChange.periodsGenerated}`);
      }
      if (dateChangeResult.endDateChange.detected) {
        console.log(`[onBudgetUpdatedCascade] ✓ End date: deactivated=${dateChangeResult.endDateChange.periodsDeactivated}, reactivated=${dateChangeResult.endDateChange.periodsReactivated}`);
      }
      if (dateChangeResult.errors.length > 0) {
        console.log(`[onBudgetUpdatedCascade] ⚠️  Date change errors: ${dateChangeResult.errors.join(', ')}`);
      }
      console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
      console.log('');
    }

  } catch (error) {
    console.error('');
    console.error('[onBudgetUpdatedCascade] ❌ CRITICAL ERROR:', error);
    console.error('');
    // Don't throw - we don't want to break budget updates if cascade fails
  }
});
