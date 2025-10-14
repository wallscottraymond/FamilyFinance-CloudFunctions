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
import { orchestrateAutoMatchingWorkflow } from '../../utils/autoMatchTransactionToOutflowPeriods';

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
  try {
    const outflowId = event.params.outflowId;
    const outflowData = event.data?.data() as RecurringOutflow;

    if (!outflowData) {
      console.error('[onOutflowCreated] No outflow data found');
      return;
    }

    // Skip inactive outflows
    if (!outflowData.isActive) {
      console.log(`[onOutflowCreated] Skipping inactive outflow: ${outflowId}`);
      return;
    }

    console.log(`[onOutflowCreated] Creating outflow periods for outflow: ${outflowId}`);
    console.log(`[onOutflowCreated] Outflow details: ${outflowData.description}, Amount: ${outflowData.averageAmount.amount}, Frequency: ${outflowData.frequency}`);

    const db = admin.firestore();

    // Calculate time range for period generation using utility function
    const { startDate, endDate } = calculatePeriodGenerationRange(outflowData, 3);

    console.log(`[onOutflowCreated] Generating outflow periods from ${startDate.toISOString()} (firstDate) to ${endDate.toISOString()} (3 months forward)`);

    // Create outflow periods using utility function
    const result = await createOutflowPeriodsFromSource(
      db,
      outflowId,
      outflowData,
      startDate,
      endDate
    );

    console.log(`[onOutflowCreated] Successfully created ${result.periodsCreated} outflow periods for outflow ${outflowId}`);

    // Auto-match historical transactions to outflow periods using orchestration function
    const matchResult = await orchestrateAutoMatchingWorkflow(
      db,
      outflowId,
      outflowData,
      result.periodIds
    );

    console.log(`[onOutflowCreated] Auto-matching workflow complete:`, {
      success: matchResult.success,
      transactionsProcessed: matchResult.transactionsProcessed,
      splitsAssigned: matchResult.splitsAssigned,
      periodsUpdated: matchResult.periodsUpdated,
      statusesUpdated: matchResult.statusesUpdated,
      errors: matchResult.errors.length
    });

  } catch (error) {
    console.error('[onOutflowCreated] Error:', error);
    // Don't throw - we don't want to break outflow creation if period generation fails
  }
});
