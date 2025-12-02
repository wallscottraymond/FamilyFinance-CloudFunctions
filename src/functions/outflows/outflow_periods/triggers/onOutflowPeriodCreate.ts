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
import { createOutflowPeriodSummary } from '../../outflow_summaries/crud/createOutflowPeriodSummary';

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

    // Step 3: Update outflow summaries (FINAL STEP - non-critical)
    console.log('[onOutflowPeriodCreate] Step 3: Updating outflow summaries...');
    try {
      await createOutflowPeriodSummary(outflowPeriodData, outflowPeriodId);
      console.log('[onOutflowPeriodCreate] ✓ Summaries updated successfully');
    } catch (summaryError) {
      console.error('[onOutflowPeriodCreate] ⚠️  Summary update failed:', summaryError);
      // Don't throw - summary failures shouldn't break the trigger
      // Summaries can be recalculated via manual API call if needed
    }

  } catch (error) {
    console.error('');
    console.error('[onOutflowPeriodCreate] ❌ ERROR:', error);
    console.error('');
    // Don't throw - we don't want to break period creation if auto-matching fails
  }
});
