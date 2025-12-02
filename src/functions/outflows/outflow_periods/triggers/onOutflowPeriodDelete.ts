/**
 * Outflow Period Post-Deletion Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is deleted.
 * It handles post-deletion operations including summary recalculation.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { OutflowPeriod } from '../../../../types';
import { deleteOutflowPeriodSummary } from '../../outflow_summaries/crud/deleteOutflowPeriodSummary';

/**
 * Triggered when an outflow_period is deleted
 * Updates summaries to reflect the deletion
 */
export const onOutflowPeriodDelete = onDocumentDeleted({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const outflowPeriodId = event.params.outflowPeriodId;
    const outflowPeriodData = event.data?.data() as OutflowPeriod;

    if (!outflowPeriodData) {
      console.error('[onOutflowPeriodDelete] No outflow period data found');
      return;
    }

    console.log('');
    console.log('[onOutflowPeriodDelete] ════════════════════════════════════════════');
    console.log('[onOutflowPeriodDelete] OUTFLOW PERIOD DELETED');
    console.log('[onOutflowPeriodDelete] ════════════════════════════════════════════');
    console.log(`[onOutflowPeriodDelete] Period ID: ${outflowPeriodId}`);
    console.log(`[onOutflowPeriodDelete] Source Period: ${outflowPeriodData.sourcePeriodId}`);
    console.log('');

    // Future orchestration steps could go here
    // Example: Clean up orphaned data, notify related systems, etc.

    // FINAL STEP: Update outflow summaries after deletion (non-critical)
    console.log('[onOutflowPeriodDelete] Updating outflow summaries after deletion...');
    try {
      await deleteOutflowPeriodSummary(outflowPeriodData);
      console.log('[onOutflowPeriodDelete] ✓ Summaries updated successfully');
    } catch (summaryError) {
      console.error('[onOutflowPeriodDelete] ⚠️  Summary update failed:', summaryError);
      // Don't throw - summary failures shouldn't break the deletion
      // Summaries can be recalculated via manual API call if needed
    }

    console.log('[onOutflowPeriodDelete] ════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[onOutflowPeriodDelete] ❌ ERROR:', error);
    console.error('');
    // Don't throw - we don't want to break period deletions
  }
});
