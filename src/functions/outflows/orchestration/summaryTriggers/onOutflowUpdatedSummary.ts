/**
 * Outflow Summary Update on Outflow Name Changes
 *
 * This trigger updates all affected outflow summaries when an outflow's
 * merchantName or userCustomName changes. It ensures denormalized names
 * stay in sync across all period entries.
 *
 * Memory: 512MiB, Timeout: 60s (higher limits due to potentially updating multiple summaries)
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Outflow } from '../../../../types';
import { batchUpdateSummary, getSummaryId } from '../../utils/summaryOperations/batchUpdateSummary';

/**
 * Triggered when an outflow is updated
 * Updates all affected summaries if merchantName or userCustomName changed
 */
export const onOutflowUpdatedSummary = onDocumentUpdated({
  document: 'outflows/{outflowId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const outflowId = event.params.outflowId;
    const beforeData = event.data?.before.data() as Outflow;
    const afterData = event.data?.after.data() as Outflow;

    if (!afterData) {
      console.error('[onOutflowUpdatedSummary] No after data found');
      return;
    }

    // Check if name fields changed
    const merchantChanged = beforeData.merchantName !== afterData.merchantName;
    const userCustomNameChanged = beforeData.userCustomName !== afterData.userCustomName;
    const descriptionChanged = beforeData.description !== afterData.description;

    if (!merchantChanged && !userCustomNameChanged && !descriptionChanged) {
      console.log(`[onOutflowUpdatedSummary] No name changes for outflow ${outflowId}, skipping`);
      return;
    }

    console.log('');
    console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
    console.log('[onOutflowUpdatedSummary] UPDATING OUTFLOW NAMES IN SUMMARIES');
    console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
    console.log(`[onOutflowUpdatedSummary] Outflow ID: ${outflowId}`);
    console.log(`[onOutflowUpdatedSummary] Old Merchant: ${beforeData.merchantName}`);
    console.log(`[onOutflowUpdatedSummary] New Merchant: ${afterData.merchantName}`);
    console.log(`[onOutflowUpdatedSummary] Old Custom Name: ${beforeData.userCustomName}`);
    console.log(`[onOutflowUpdatedSummary] New Custom Name: ${afterData.userCustomName}`);
    console.log('');

    const db = admin.firestore();

    // Step 1: Find all affected summaries by querying outflow_periods
    console.log('[onOutflowUpdatedSummary] Finding affected summaries...');

    const periodsQuery = await db.collection('outflow_periods')
      .where('outflowId', '==', outflowId)
      .where('isActive', '==', true)
      .limit(100) // Safety limit
      .get();

    if (periodsQuery.empty) {
      console.log('[onOutflowUpdatedSummary] No active periods found for this outflow');
      console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
      console.log('');
      return;
    }

    console.log(`[onOutflowUpdatedSummary] Found ${periodsQuery.size} active periods`);

    // Step 2: Group periods by (ownerId, periodType) to identify unique summaries
    interface SummaryKey {
      ownerId: string;
      ownerType: 'user' | 'group';
      periodType: import('../../../../types').PeriodType;
    }

    const summariesToUpdate = new Map<string, SummaryKey>();

    periodsQuery.forEach(doc => {
      const period = doc.data();
      const periodType = determinePeriodType(period.sourcePeriodId);

      // Add user summary
      const userKey = `${period.ownerId}_user_${periodType}`;
      if (!summariesToUpdate.has(userKey)) {
        summariesToUpdate.set(userKey, {
          ownerId: period.ownerId,
          ownerType: 'user',
          periodType
        });
      }

      // Add group summary if applicable
      if (period.groupId) {
        const groupKey = `${period.groupId}_group_${periodType}`;
        if (!summariesToUpdate.has(groupKey)) {
          summariesToUpdate.set(groupKey, {
            ownerId: period.groupId,
            ownerType: 'group',
            periodType
          });
        }
      }
    });

    console.log(`[onOutflowUpdatedSummary] Found ${summariesToUpdate.size} unique summaries to update`);

    // Step 3: Update each affected summary
    const merchant = afterData.merchantName || afterData.description || 'Unknown';
    const userCustomName = afterData.userCustomName || afterData.merchantName || afterData.description || 'Unknown';

    for (const [key, summaryKey] of summariesToUpdate.entries()) {
      try {
        const summaryId = getSummaryId(
          summaryKey.ownerId,
          summaryKey.ownerType,
          summaryKey.periodType
        );

        console.log(`[onOutflowUpdatedSummary] Updating summary: ${summaryId}`);

        await batchUpdateSummary({
          summaryId,
          operations: [{
            type: 'updateNames',
            data: {
              outflowId,
              merchant,
              userCustomName
            }
          }]
        });

        console.log(`[onOutflowUpdatedSummary] ✓ Summary ${summaryId} updated`);

      } catch (error) {
        console.error(`[onOutflowUpdatedSummary] ❌ Error updating ${key}:`, error);
        // Continue with other summaries even if one fails
      }
    }

    console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[onOutflowUpdatedSummary] ❌ ERROR:', error);
    console.error('');
    // Don't throw - summary update failures shouldn't break outflow updates
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
