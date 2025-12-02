/**
 * Delete Outflow Period Summary
 *
 * Updates user and group summaries when an outflow period is deleted.
 * This function is called from the centralized summary trigger when
 * an outflow_period document is removed.
 *
 * The function recalculates the affected period group to reflect the
 * deletion and ensure summary totals remain accurate.
 */
import { OutflowPeriod } from '../../../../types';
/**
 * Update outflow summaries for a deleted period
 *
 * Updates both user and group summaries (if applicable) when an outflow
 * period is deleted. This ensures the period-centric summary system stays
 * in sync and total amounts are recalculated without the deleted period.
 *
 * @param periodData - The deleted outflow period data (from before snapshot)
 *
 * @throws Error if summary update fails (caller should catch and handle gracefully)
 *
 * @example
 * // Called from centralized trigger (summaries/triggers/outflowPeriodSummaryTriggers.ts)
 * try {
 *   await deleteOutflowPeriodSummary(outflowPeriod);
 *   console.log('✓ Summary updated after deletion');
 * } catch (error) {
 *   console.error('⚠️  Summary update failed:', error);
 *   // Don't re-throw - period deletion succeeds even if summary fails
 * }
 */
export declare function deleteOutflowPeriodSummary(periodData: OutflowPeriod): Promise<void>;
//# sourceMappingURL=deleteOutflowPeriodSummary.d.ts.map