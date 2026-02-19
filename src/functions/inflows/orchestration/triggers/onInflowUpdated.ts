/**
 * Inflow Updated Trigger
 *
 * This Cloud Function automatically updates inflow_periods when an inflow is modified.
 * It handles changes to amount, custom name, and transaction IDs.
 *
 * Key Features:
 * - Detects changes to averageAmount, userCustomName, transactionIds
 * - Cascades updates to all related inflow_periods
 * - Re-runs transaction alignment when new transactions are added
 * - Preserves received income data (only updates unreceived periods for amounts)
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { Inflow } from '../../../../types';
import { runUpdateInflowPeriods } from '../../inflow_periods/utils/runUpdateInflowPeriods';

/**
 * Triggered when an inflow is updated
 * Automatically cascades changes to inflow_periods
 */
export const onInflowUpdated = onDocumentUpdated({
  document: 'inflows/{inflowId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const inflowId = event.params.inflowId;
    const beforeData = event.data?.before.data() as Partial<Inflow>;
    const afterData = event.data?.after.data() as Partial<Inflow>;

    if (!beforeData || !afterData) {
      console.error('[onInflowUpdated] Missing before or after data');
      return;
    }

    // Skip if inflow is inactive
    if (!afterData.isActive) {
      console.log(`[onInflowUpdated] Skipping inactive inflow: ${inflowId}`);
      return;
    }

    console.log(`[onInflowUpdated] Processing update for inflow: ${inflowId}`);
    console.log(`[onInflowUpdated] Description: ${afterData.description || afterData.userCustomName || 'unnamed'}`);

    // Initialize Firestore
    const db = admin.firestore();

    // Run the update logic
    const result = await runUpdateInflowPeriods(
      db,
      inflowId,
      beforeData,
      afterData
    );

    if (result.success) {
      console.log(`[onInflowUpdated] ✓ Successfully processed inflow ${inflowId}`);
      console.log(`[onInflowUpdated]   - Periods queried: ${result.periodsQueried}`);
      console.log(`[onInflowUpdated]   - Periods updated: ${result.periodsUpdated}`);
      console.log(`[onInflowUpdated]   - Periods skipped: ${result.periodsSkipped}`);
      console.log(`[onInflowUpdated]   - Fields updated: ${result.fieldsUpdated.join(', ') || 'none'}`);
    } else {
      console.error(`[onInflowUpdated] ✗ Failed to process inflow ${inflowId}`);
      console.error(`[onInflowUpdated]   - Errors: ${result.errors.join(', ')}`);
    }

  } catch (error) {
    console.error('[onInflowUpdated] Error:', error);
    // Don't throw - we don't want to break other operations
  }
});
