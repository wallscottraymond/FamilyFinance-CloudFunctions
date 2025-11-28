/**
 * Outflow Period Summary Update on Update
 *
 * This trigger updates the outflow summary when an outflow_period is updated.
 * It recalculates the affected sourcePeriodId group to reflect changes in amounts or status.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { OutflowPeriod } from '../../../../types';
import { batchUpdateSummary, getSummaryId } from '../../utils/summaryOperations/batchUpdateSummary';

/**
 * Triggered when an outflow_period is updated
 * Updates user and group summaries by recalculating the affected period group
 */
export const onOutflowPeriodUpdatedSummary = onDocumentUpdated({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const outflowPeriodId = event.params.outflowPeriodId;
    const beforeData = event.data?.before.data() as OutflowPeriod;
    const afterData = event.data?.after.data() as OutflowPeriod;

    if (!afterData) {
      console.error('[onOutflowPeriodUpdatedSummary] No after data found');
      return;
    }

    // Check if relevant fields changed
    const relevantFieldsChanged = hasRelevantChanges(beforeData, afterData);

    if (!relevantFieldsChanged) {
      console.log(`[onOutflowPeriodUpdatedSummary] No relevant changes for ${outflowPeriodId}, skipping summary update`);
      return;
    }

    console.log('');
    console.log('[onOutflowPeriodUpdatedSummary] ════════════════════════════════════════════');
    console.log('[onOutflowPeriodUpdatedSummary] UPDATING OUTFLOW SUMMARY');
    console.log('[onOutflowPeriodUpdatedSummary] ════════════════════════════════════════════');
    console.log(`[onOutflowPeriodUpdatedSummary] Period ID: ${outflowPeriodId}`);
    console.log(`[onOutflowPeriodUpdatedSummary] Source Period: ${afterData.sourcePeriodId}`);
    console.log('');

    // Determine period type from source period ID
    const periodType = determinePeriodType(afterData.sourcePeriodId);

    // Update user summary
    const userSummaryId = getSummaryId(afterData.ownerId, 'user', periodType);
    console.log(`[onOutflowPeriodUpdatedSummary] Updating user summary: ${userSummaryId}`);

    await batchUpdateSummary({
      summaryId: userSummaryId,
      operations: [{
        type: 'recalculate',
        data: {
          sourcePeriodId: afterData.sourcePeriodId,
          ownerId: afterData.ownerId,
          ownerType: 'user',
          periodType
        }
      }]
    });

    console.log(`[onOutflowPeriodUpdatedSummary] ✓ User summary updated successfully`);

    // Update group summary if period belongs to a group
    if (afterData.groupId) {
      const groupSummaryId = getSummaryId(afterData.groupId, 'group', periodType);
      console.log(`[onOutflowPeriodUpdatedSummary] Updating group summary: ${groupSummaryId}`);

      await batchUpdateSummary({
        summaryId: groupSummaryId,
        operations: [{
          type: 'recalculate',
          data: {
            sourcePeriodId: afterData.sourcePeriodId,
            ownerId: afterData.groupId,
            ownerType: 'group',
            periodType
          }
        }]
      });

      console.log(`[onOutflowPeriodUpdatedSummary] ✓ Group summary updated successfully`);
    }

    console.log('[onOutflowPeriodUpdatedSummary] ════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[onOutflowPeriodUpdatedSummary] ❌ ERROR:', error);
    console.error('');
    // Don't throw - summary update failures shouldn't break period updates
  }
});

/**
 * Check if any relevant fields changed that would affect the summary
 */
function hasRelevantChanges(before: OutflowPeriod, after: OutflowPeriod): boolean {
  return (
    before.totalAmountDue !== after.totalAmountDue ||
    before.totalAmountPaid !== after.totalAmountPaid ||
    before.totalAmountUnpaid !== after.totalAmountUnpaid ||
    before.amountWithheld !== after.amountWithheld ||
    before.averageAmount !== after.averageAmount ||
    before.isDuePeriod !== after.isDuePeriod ||
    before.status !== after.status ||
    before.isFullyPaid !== after.isFullyPaid ||
    before.isPartiallyPaid !== after.isPartiallyPaid ||
    before.isActive !== after.isActive
  );
}

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
