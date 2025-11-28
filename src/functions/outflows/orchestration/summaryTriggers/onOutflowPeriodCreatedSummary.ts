/**
 * Outflow Period Summary Update on Creation
 *
 * This trigger updates the outflow summary when a new outflow_period is created.
 * It recalculates the affected sourcePeriodId group to ensure accurate aggregations.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { OutflowPeriod } from '../../../../types';
import { batchUpdateSummary, getSummaryId } from '../../utils/summaryOperations/batchUpdateSummary';

/**
 * Triggered when an outflow_period is created
 * Updates user and group summaries by recalculating the affected period group
 */
export const onOutflowPeriodCreatedSummary = onDocumentCreated({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const outflowPeriodId = event.params.outflowPeriodId;
    const periodData = event.data?.data() as OutflowPeriod;

    if (!periodData) {
      console.error('[onOutflowPeriodCreatedSummary] No period data found');
      return;
    }

    console.log('');
    console.log('[onOutflowPeriodCreatedSummary] ════════════════════════════════════════════');
    console.log('[onOutflowPeriodCreatedSummary] UPDATING OUTFLOW SUMMARY');
    console.log('[onOutflowPeriodCreatedSummary] ════════════════════════════════════════════');
    console.log(`[onOutflowPeriodCreatedSummary] Period ID: ${outflowPeriodId}`);
    console.log(`[onOutflowPeriodCreatedSummary] Source Period: ${periodData.sourcePeriodId}`);
    console.log(`[onOutflowPeriodCreatedSummary] Owner: ${periodData.ownerId}`);
    console.log('');

    // Determine period type from source period ID
    const periodType = determinePeriodType(periodData.sourcePeriodId);

    // Update user summary
    const userSummaryId = getSummaryId(periodData.ownerId, 'user', periodType);
    console.log(`[onOutflowPeriodCreatedSummary] Updating user summary: ${userSummaryId}`);

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

    console.log(`[onOutflowPeriodCreatedSummary] ✓ User summary updated successfully`);

    // Update group summary if period belongs to a group
    if (periodData.groupId) {
      const groupSummaryId = getSummaryId(periodData.groupId, 'group', periodType);
      console.log(`[onOutflowPeriodCreatedSummary] Updating group summary: ${groupSummaryId}`);

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

      console.log(`[onOutflowPeriodCreatedSummary] ✓ Group summary updated successfully`);
    }

    console.log('[onOutflowPeriodCreatedSummary] ════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[onOutflowPeriodCreatedSummary] ❌ ERROR:', error);
    console.error('');
    // Don't throw - summary update failures shouldn't break period creation
  }
});

/**
 * Determine PeriodType from sourcePeriodId format
 * Examples: 2025-M01 (monthly), 2025-BM01-1 (bi-monthly), 2025-W01 (weekly)
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
  // Default to monthly if unable to determine
  return PeriodType.MONTHLY;
}
