/**
 * Outflow Period Summary Triggers
 *
 * Centralized triggers that update user_summaries when outflow_periods change.
 * These replace the old outflow_summaries system with the new unified user_summaries architecture.
 *
 * Trigger Flow:
 * 1. outflow_period created/updated/deleted
 * 2. Trigger fires
 * 3. Calls updateUserPeriodSummary() to recalculate the affected period
 * 4. user_summaries document updated with latest outflow data
 */

import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { OutflowPeriod } from '../../../types';
import { updateUserPeriodSummary } from '../orchestration/updateUserPeriodSummary';

/**
 * Trigger: When an outflow_period is created
 *
 * Updates the user_summaries document for this period with the new outflow period entry.
 */
export const onOutflowPeriodCreatedSummary = onDocumentCreated({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const outflowPeriodData = event.data?.data() as OutflowPeriod;

    if (!outflowPeriodData) {
      console.error('[onOutflowPeriodCreatedSummary] No outflow period data found');
      return;
    }

    console.log('[onOutflowPeriodCreatedSummary] Updating user summary for new outflow period');
    console.log(`  - Source Period: ${outflowPeriodData.sourcePeriodId}`);
    console.log(`  - Period Type: ${outflowPeriodData.periodType}`);
    console.log(`  - Owner: ${outflowPeriodData.ownerId}`);
    console.log(`  - Description: ${outflowPeriodData.description}`);

    // Update the user_summaries document for this period
    await updateUserPeriodSummary(
      outflowPeriodData.ownerId,
      outflowPeriodData.periodType,
      outflowPeriodData.sourcePeriodId,
      true // Always include entries for tile rendering
    );

    console.log('[onOutflowPeriodCreatedSummary] Successfully updated user summary');
  } catch (error) {
    console.error('[onOutflowPeriodCreatedSummary] Error updating summary:', error);
    // Don't throw - summary updates should not break period creation
  }
});

/**
 * Trigger: When an outflow_period is updated
 *
 * Recalculates the user_summaries document for this period to reflect changes.
 */
export const onOutflowPeriodUpdatedSummary = onDocumentUpdated({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const afterData = event.data?.after.data() as OutflowPeriod;

    if (!afterData) {
      console.error('[onOutflowPeriodUpdatedSummary] No after data found');
      return;
    }

    console.log('[onOutflowPeriodUpdatedSummary] Updating user summary for modified outflow period');
    console.log(`  - Source Period: ${afterData.sourcePeriodId}`);
    console.log(`  - Period Type: ${afterData.periodType}`);
    console.log(`  - Owner: ${afterData.ownerId}`);

    // Update the user_summaries document for this period
    await updateUserPeriodSummary(
      afterData.ownerId,
      afterData.periodType,
      afterData.sourcePeriodId,
      true // Always include entries for tile rendering
    );

    console.log('[onOutflowPeriodUpdatedSummary] Successfully updated user summary');
  } catch (error) {
    console.error('[onOutflowPeriodUpdatedSummary] Error updating summary:', error);
    // Don't throw - summary updates should not break period updates
  }
});

/**
 * Trigger: When an outflow_period is deleted
 *
 * Recalculates the user_summaries document to remove the deleted period entry.
 */
export const onOutflowPeriodDeletedSummary = onDocumentDeleted({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const deletedData = event.data?.data() as OutflowPeriod;

    if (!deletedData) {
      console.error('[onOutflowPeriodDeletedSummary] No deleted data found');
      return;
    }

    console.log('[onOutflowPeriodDeletedSummary] Updating user summary after period deletion');
    console.log(`  - Source Period: ${deletedData.sourcePeriodId}`);
    console.log(`  - Period Type: ${deletedData.periodType}`);
    console.log(`  - Owner: ${deletedData.ownerId}`);

    // Recalculate the user_summaries document (it will fetch remaining periods)
    await updateUserPeriodSummary(
      deletedData.ownerId,
      deletedData.periodType,
      deletedData.sourcePeriodId,
      true // Always include entries for tile rendering
    );

    console.log('[onOutflowPeriodDeletedSummary] Successfully updated user summary');
  } catch (error) {
    console.error('[onOutflowPeriodDeletedSummary] Error updating summary:', error);
    // Don't throw - summary updates should not break period deletion
  }
});
