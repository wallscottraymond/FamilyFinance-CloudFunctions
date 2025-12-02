/**
 * Outflow Update Orchestration
 *
 * Automatically updates outflow periods when parent outflow changes from:
 * - Plaid webhook updates (amount changes, new transactions)
 * - Manual user edits (custom name changes)
 *
 * Updates: Future unpaid periods only (preserves payment history)
 *
 * Triggers on changes to:
 * - averageAmount: Recalculates period withholding amounts
 * - userCustomName: Updates period descriptions
 * - transactionIds: Re-runs auto-matching for transaction assignments
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Outflow } from '../../../../types';
import { runUpdateOutflowPeriods } from '../../utils/runUpdateOutflowPeriods';

/**
 * Triggered when an outflow is updated
 * Automatically updates unpaid outflow_periods when relevant fields change
 */
export const onOutflowUpdated = onDocumentUpdated({
  document: 'outflows/{outflowId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const outflowId = event.params.outflowId;
    const outflowBefore = event.data?.before.data() as Outflow | undefined;
    const outflowAfter = event.data?.after.data() as Outflow | undefined;

    if (!outflowBefore || !outflowAfter) {
      console.error('[onOutflowUpdated] Missing before/after data');
      return;
    }

    console.log('');
    console.log('[onOutflowUpdated] ════════════════════════════════════════════');
    console.log('[onOutflowUpdated] OUTFLOW UPDATED');
    console.log('[onOutflowUpdated] ════════════════════════════════════════════');
    console.log(`[onOutflowUpdated] Outflow ID: ${outflowId}`);
    console.log(`[onOutflowUpdated] Description: ${outflowAfter.description}`);
    console.log(`[onOutflowUpdated] Merchant: ${outflowAfter.merchantName}`);
    console.log('');

    const db = admin.firestore();

    // Run update orchestration
    console.log('[onOutflowUpdated] Calling runUpdateOutflowPeriods...');
    const result = await runUpdateOutflowPeriods(
      db,
      outflowId,
      outflowBefore,
      outflowAfter
    );

    console.log('');
    console.log('[onOutflowUpdated] ════════════════════════════════════════════');
    console.log('[onOutflowUpdated] UPDATE COMPLETE');
    console.log('[onOutflowUpdated] ════════════════════════════════════════════');

    if (result.fieldsUpdated.length === 0) {
      console.log(`[onOutflowUpdated] No relevant changes detected`);
    } else {
      console.log(`[onOutflowUpdated] ✓ Fields changed: ${result.fieldsUpdated.join(', ')}`);
      console.log(`[onOutflowUpdated] ✓ Periods queried: ${result.periodsQueried}`);
      console.log(`[onOutflowUpdated] ✓ Periods updated: ${result.periodsUpdated}`);
      console.log(`[onOutflowUpdated] ✓ Periods skipped (paid): ${result.periodsSkipped}`);
    }

    if (result.errors.length > 0) {
      console.log(`[onOutflowUpdated] ⚠️  Errors encountered: ${result.errors.length}`);
      result.errors.forEach((err, idx) => {
        console.log(`[onOutflowUpdated]    ${idx + 1}. ${err}`);
      });
    }

    console.log('[onOutflowUpdated] ════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('[onOutflowUpdated] ❌ CRITICAL ERROR:', error);
    console.error('');
    // Don't throw - we don't want to break outflow updates if period sync fails
  }
});
