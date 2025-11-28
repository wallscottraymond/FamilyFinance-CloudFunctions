/**
 * Outflow Period Post-Creation Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is created.
 * It automatically matches historical transactions to this period and
 * updates the period's payment status.
 *
 * Memory: 256MiB, Timeout: 30s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { OutflowPeriod, Outflow } from '../../../../types';
import { autoMatchSinglePeriod } from '../../utils/autoMatchSinglePeriod';
import { batchUpdateSummary, getSummaryId } from '../../utils/summaryOperations/batchUpdateSummary';

/**
 * Triggered when an outflow_period is created
 * Auto-matches transactions to this specific period
 */
export const onOutflowPeriodCreate = onDocumentCreated({
  document: 'outflow_periods/{outflowPeriodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  try {
    const outflowPeriodId = event.params.outflowPeriodId;
    const outflowPeriodData = event.data?.data() as OutflowPeriod;

    if (!outflowPeriodData) {
      console.error('[onOutflowPeriodCreate] No outflow period data found');
      return;
    }

    console.log('');
    console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
    console.log('[onOutflowPeriodCreate] NEW OUTFLOW PERIOD CREATED');
    console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
    console.log(`[onOutflowPeriodCreate] Period ID: ${outflowPeriodId}`);
    console.log(`[onOutflowPeriodCreate] Description: ${outflowPeriodData.description}`);
    console.log(`[onOutflowPeriodCreate] Period Type: ${outflowPeriodData.periodType}`);
    console.log(`[onOutflowPeriodCreate] Source Period: ${outflowPeriodData.sourcePeriodId}`);
    console.log(`[onOutflowPeriodCreate] Period Range: ${outflowPeriodData.periodStartDate?.toDate().toISOString().split('T')[0]} to ${outflowPeriodData.periodEndDate?.toDate().toISOString().split('T')[0]}`);
    console.log(`[onOutflowPeriodCreate] Expected Amount: $${outflowPeriodData.expectedAmount || outflowPeriodData.amountWithheld}`);
    console.log('');

    const db = admin.firestore();

    // Step 1: Get parent outflow
    console.log('[onOutflowPeriodCreate] Step 1: Fetching parent outflow...');
    const outflowRef = db.collection('outflows').doc(outflowPeriodData.outflowId);
    const outflowSnap = await outflowRef.get();

    if (!outflowSnap.exists) {
      console.error(`[onOutflowPeriodCreate] Parent outflow not found: ${outflowPeriodData.outflowId}`);
      return;
    }

    const outflow = { id: outflowSnap.id, ...outflowSnap.data() } as Outflow;
    console.log(`[onOutflowPeriodCreate] ✓ Found parent outflow: ${outflow.description}`);
    console.log(`[onOutflowPeriodCreate] ✓ Transaction IDs in outflow: ${outflow.transactionIds?.length || 0}`);
    console.log('');

    // Step 2: Auto-match transactions for this specific period
    const transactionIds = outflow.transactionIds || [];
    if (transactionIds.length === 0) {
      console.log('[onOutflowPeriodCreate] No historical transactions to match (transactionIds empty)');
      console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
      console.log('');
      return;
    }

    console.log('[onOutflowPeriodCreate] Step 2: Auto-matching transactions to this period...');
    const result = await autoMatchSinglePeriod(
      db,
      outflowPeriodId,
      outflowPeriodData,
      outflow
    );

    console.log('');
    console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
    console.log('[onOutflowPeriodCreate] AUTO-MATCH COMPLETE');
    console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
    console.log(`[onOutflowPeriodCreate] ✓ Transactions matched: ${result.transactionsMatched}`);
    console.log(`[onOutflowPeriodCreate] ✓ Splits assigned: ${result.splitsAssigned}`);
    console.log(`[onOutflowPeriodCreate] ✓ Period updated: ${result.periodUpdated ? 'Yes' : 'No'}`);
    console.log(`[onOutflowPeriodCreate] ✓ Final status: ${result.finalStatus || 'N/A'}`);

    if (result.errors.length > 0) {
      console.log(`[onOutflowPeriodCreate] ⚠️  Errors: ${result.errors.length}`);
      result.errors.forEach(err => console.log(`[onOutflowPeriodCreate]    - ${err}`));
    }

    console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
    console.log('');

    // Step 3: Update outflow summaries
    console.log('[onOutflowPeriodCreate] Step 3: Updating outflow summaries...');
    try {
      // Determine period type from source period ID
      const periodType = determinePeriodType(outflowPeriodData.sourcePeriodId);

      // Update user summary
      const userSummaryId = getSummaryId(outflowPeriodData.ownerId, 'user', periodType);
      console.log(`[onOutflowPeriodCreate] ✓ Updating user summary: ${userSummaryId}`);

      await batchUpdateSummary({
        summaryId: userSummaryId,
        operations: [{
          type: 'recalculate',
          data: {
            sourcePeriodId: outflowPeriodData.sourcePeriodId,
            ownerId: outflowPeriodData.ownerId,
            ownerType: 'user',
            periodType
          }
        }]
      });

      console.log(`[onOutflowPeriodCreate] ✓ User summary updated successfully`);

      // Update group summary if period belongs to a group
      if (outflowPeriodData.groupId) {
        const groupSummaryId = getSummaryId(outflowPeriodData.groupId, 'group', periodType);
        console.log(`[onOutflowPeriodCreate] ✓ Updating group summary: ${groupSummaryId}`);

        await batchUpdateSummary({
          summaryId: groupSummaryId,
          operations: [{
            type: 'recalculate',
            data: {
              sourcePeriodId: outflowPeriodData.sourcePeriodId,
              ownerId: outflowPeriodData.groupId,
              ownerType: 'group',
              periodType
            }
          }]
        });

        console.log(`[onOutflowPeriodCreate] ✓ Group summary updated successfully`);
      }
    } catch (summaryError) {
      console.error('[onOutflowPeriodCreate] ⚠️  Summary update failed:', summaryError);
      // Don't throw - summary failures shouldn't break the trigger
    }

  } catch (error) {
    console.error('');
    console.error('[onOutflowPeriodCreate] ❌ ERROR:', error);
    console.error('');
    // Don't throw - we don't want to break period creation if auto-matching fails
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
