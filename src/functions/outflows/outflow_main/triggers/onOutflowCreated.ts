/**
 * Outflow Periods Auto-Generation Trigger
 *
 * This Cloud Function automatically creates outflow_periods when an outflow is created.
 * It is a pure orchestration trigger that delegates all business logic to utility functions.
 *
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { RecurringOutflow } from '../../../../types';
import {
  createOutflowPeriodsFromSource,
  calculatePeriodGenerationRange
} from '../../utils/outflowPeriods';
import { batchUpdateUserPeriodSummariesFromOutflowPeriods } from '../../../summaries/utils/batchUpdateUserPeriodSummaries';

/**
 * Triggered when an outflow is created
 * Automatically generates outflow_periods for all active source periods
 */
export const onOutflowCreated = onDocumentCreated({
  document: 'outflows/{outflowId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  console.log('');
  console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
  console.log('🔥 TRIGGER FIRED: onOutflowCreated');
  console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
  console.log('');

  try {
    const outflowId = event.params.outflowId;
    console.log(`[onOutflowCreated] Extracting outflow ID: ${outflowId}`);

    const outflowData = event.data?.data() as RecurringOutflow;

    if (!outflowData) {
      console.error('');
      console.error('❌ ERROR: No outflow data found in event');
      console.error(`   Event params:`, event.params);
      console.error(`   Event data exists: ${!!event.data}`);
      return;
    }

    console.log(`[onOutflowCreated] ✓ Outflow data extracted successfully`);
    console.log(`[onOutflowCreated] Outflow Details:`);
    console.log(`  - ID: ${outflowId}`);
    console.log(`  - Description: ${outflowData.description}`);
    console.log(`  - Amount: $${outflowData.averageAmount}`);
    console.log(`  - Frequency: ${outflowData.frequency}`);
    console.log(`  - First Date: ${outflowData.firstDate?.toDate().toISOString()}`);
    console.log(`  - Is Active: ${outflowData.isActive}`);
    console.log(`  - User ID: ${outflowData.ownerId}`);

    // Skip inactive outflows
    if (!outflowData.isActive) {
      console.log('');
      console.log('⏭️  SKIPPING: Outflow is inactive');
      console.log(`   Outflow ID: ${outflowId}`);
      return;
    }

    console.log('');
    console.log('[onOutflowCreated] ✓ Outflow is ACTIVE - proceeding with period generation');

    const db = admin.firestore();

    // Calculate time range for period generation using utility function
    console.log('');
    console.log('[onOutflowCreated] STEP 1: Calculate period generation range');
    const { startDate, endDate } = calculatePeriodGenerationRange(outflowData, 15);
    console.log(`  - Start Date: ${startDate.toISOString()} (from outflow.firstDate)`);
    console.log(`  - End Date: ${endDate.toISOString()} (15 months forward from now)`);
    console.log(`  - Total span: ${Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days`);

    // Create outflow periods using utility function
    console.log('');
    console.log('[onOutflowCreated] STEP 2: Calling createOutflowPeriodsFromSource...');
    console.log(`  - Outflow ID: ${outflowId}`);
    console.log(`  - Outflow Description: ${outflowData.description}`);
    console.log(`  - Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const result = await createOutflowPeriodsFromSource(
      db,
      outflowId,
      outflowData,
      startDate,
      endDate
    );

    console.log('');
    console.log('[onOutflowCreated] STEP 3: Period creation completed');
    console.log(`  ✓ Periods Created: ${result.periodsCreated}`);
    console.log(`  ✓ Period IDs: ${result.periodIds.join(', ')}`);

    // STEP 4: Batch update user period summaries
    if (outflowData.ownerId && result.periodIds.length > 0) {
      console.log('');
      console.log('[onOutflowCreated] STEP 4: Batch updating user period summaries');
      console.log(`  - Updating summaries for ${result.periodIds.length} periods`);
      console.log(`  - User ID: ${outflowData.ownerId}`);

      try {
        const summariesUpdated = await batchUpdateUserPeriodSummariesFromOutflowPeriods(
          outflowData.ownerId,
          result.periodIds
        );

        console.log('');
        console.log('[onOutflowCreated] ✓ Batch summary update completed');
        console.log(`  ✓ Summaries Updated: ${summariesUpdated}`);
      } catch (summaryError) {
        console.error('');
        console.error('[onOutflowCreated] ⚠️  Error updating summaries (non-fatal):');
        console.error(summaryError);
        console.log('[onOutflowCreated] Continuing despite summary update error...');
      }
    }

    console.log('');
    console.log('[onOutflowCreated] ℹ️  Auto-matching will happen per-period via onOutflowPeriodCreate triggers');
    console.log('[onOutflowCreated] Each period will independently match its transactions when created');

  } catch (error) {
    console.error('');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('❌ TRIGGER ERROR in onOutflowCreated');
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.error('[onOutflowCreated] Error details:', error);
    if (error instanceof Error) {
      console.error(`  - Message: ${error.message}`);
      console.error(`  - Stack: ${error.stack}`);
    }
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    // Don't throw - we don't want to break outflow creation if period generation fails
  }
});
