/**
 * Outflow Period Summary Update on Deletion
 *
 * This trigger updates the outflow summary when an outflow_period is deleted.
 * It recalculates the affected sourcePeriodId group, potentially removing it if empty.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { OutflowPeriod } from '../../../../types';
import { batchUpdateSummary, getSummaryId } from '../../utils/summaryOperations/batchUpdateSummary';

/**
 * Triggered when an outflow_period is deleted
 * Updates user and group summaries by recalculating the affected period group
 * If this was the last period in the group, the entire sourcePeriodId key is removed
 */
export const onOutflowPeriodDeletedSummary = onDocumentDeleted({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const outflowPeriodId = event.params.outflowPeriodId;
    const periodData = event.data?.data() as OutflowPeriod;

    if (!periodData) {
      console.error('[onOutflowPeriodDeletedSummary] No period data found');
      return;
    }

    console.log('');
    console.log('[onOutflowPeriodDeletedSummary] ════════════════════════════════════════════');
    console.log('[onOutflowPeriodDeletedSummary] UPDATING OUTFLOW SUMMARY');
    console.log('[onOutflowPeriodDeletedSummary] ════════════════════════════════════════════');
    console.log(`[onOutflowPeriodDeletedSummary] Period ID: ${outflowPeriodId}`);
    console.log(`[onOutflowPeriodDeletedSummary] Source Period: ${periodData.sourcePeriodId}`);
    console.log('');

    // Determine period type from source period ID
    const periodType = determinePeriodType(periodData.sourcePeriodId);

    // Update user summary
    const userSummaryId = getSummaryId(periodData.ownerId, 'user', periodType);
    console.log(`[onOutflowPeriodDeletedSummary] Updating user summary: ${userSummaryId}`);

    await batchUpdateSummary({
      summaryId: userSummaryId,
      operations: [{
        type: 'recalculate',
        data: {
          sourcePeriodId: periodData.sourcePeriodId,
          ownerId: periodData.ownerId,
          ownerType: 'user',
          periodType
        }
      }]
    });

    console.log(`[onOutflowPeriodDeletedSummary] ✓ User summary updated successfully`);

    // Update group summary if period belonged to a group
    if (periodData.groupId) {
      const groupSummaryId = getSummaryId(periodData.groupId, 'group', periodType);
      console.log(`[onOutflowPeriodDeletedSummary] Updating group summary: ${groupSummaryId}`);

      await batchUpdateSummary({
        summaryId: groupSummaryId,
        operations: [{
          type: 'recalculate',
          data: {
            sourcePeriodId: periodData.sourcePeriodId,
            ownerId: periodData.groupId,
            ownerType: 'group',
            periodType
          }
        }]
      });

      console.log(`[onOutflowPeriodDeletedSummary] ✓ Group summary updated successfully`);
    }

    console.log('[onOutflowPeriodDeletedSummary] ════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[onOutflowPeriodDeletedSummary] ❌ ERROR:', error);
    console.error('');
    // Don't throw - summary update failures shouldn't break period deletion
  }
});

/**
 * Determine PeriodType from sourcePeriodId format
 */
function determinePeriodType(sourcePeriodId: string): import('../../../../types').PeriodType {
  const { PeriodType } = require('../../../../types');

  if (sourcePeriodId.includes('-M') && !sourcePeriodId.includes('-BM')) {
    return PeriodType.MONTHLY;
  } else if (sourcePeriodId.includes('-BM')) {
    return PeriodType.BI_MONTHLY;
  } else if (sourcePeriodId.includes('-W')) {
    return PeriodType.WEEKLY;
  }
  return PeriodType.MONTHLY;
}
