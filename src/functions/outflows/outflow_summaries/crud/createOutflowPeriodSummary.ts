/**
 * Create Outflow Period Summary
 *
 * Updates user_summaries collection when an outflow period is created.
 * This function is called from the onOutflowPeriodCreate trigger as the
 * final step after all critical business logic completes.
 *
 * The function performs graceful degradation - summary failures are logged
 * but do not throw errors to prevent breaking the period creation process.
 * Summaries can be recalculated later if needed via manual API calls.
 */

import { OutflowPeriod } from '../../../../types';
import { updateUserPeriodSummary } from '../../../summaries/orchestration/updateUserPeriodSummary';
import { determinePeriodType } from '../utils/periodTypeHelpers';

/**
 * Update user_summaries for a newly created outflow period
 *
 * Updates the user_summaries collection when an outflow period is created.
 * This ensures the period-centric summary system stays in sync with the
 * latest outflow period data.
 *
 * @param periodData - The outflow period data
 * @param outflowPeriodId - The outflow period document ID
 *
 * @throws Error if summary update fails (caller should catch and handle gracefully)
 *
 * @example
 * // Called from onOutflowPeriodCreate trigger (FINAL STEP - non-critical)
 * try {
 *   await createOutflowPeriodSummary(outflowPeriodData, outflowPeriodId);
 *   console.log('✓ Summaries updated successfully');
 * } catch (summaryError) {
 *   console.error('⚠️  Summary update failed:', summaryError);
 *   // Don't re-throw - period creation succeeds even if summaries fail
 * }
 */
export async function createOutflowPeriodSummary(
  periodData: OutflowPeriod,
  outflowPeriodId: string
): Promise<void> {
  console.log('[createOutflowPeriodSummary] Updating user_summaries...');

  // Determine period type from source period ID
  const periodType = determinePeriodType(periodData.sourcePeriodId);

  // Update user_summaries collection
  console.log(`[createOutflowPeriodSummary] ✓ Updating user_summaries for period: ${periodData.sourcePeriodId}`);

  await updateUserPeriodSummary(
    periodData.ownerId,
    periodType,
    periodData.sourcePeriodId,
    true // Always include entries for tile rendering
  );

  console.log(`[createOutflowPeriodSummary] ✓ user_summaries updated successfully`);

  // TODO: Add group summary support when group summaries are implemented
  if (periodData.groupId) {
    console.log(`[createOutflowPeriodSummary] ⚠️  Group summaries not yet implemented for groupId: ${periodData.groupId}`);
  }

  console.log('[createOutflowPeriodSummary] ✓ Summary updates complete');
}
