/**
 * Update Outflow Period Summary
 *
 * Updates user and group summaries when an outflow period is updated.
 * This function is called from the centralized summary trigger when
 * an outflow_period document is modified.
 *
 * The function recalculates the affected period group to reflect changes
 * in amounts, status, or other relevant fields.
 */
import { OutflowPeriod } from '../../../../types';
/**
 * Update outflow summaries for a modified period
 *
 * Updates both user and group summaries (if applicable) when an outflow
 * period is updated. This ensures the period-centric summary system stays
 * in sync with changes to amounts, status, or payment information.
 *
 * @param periodData - The updated outflow period data
 *
 * @throws Error if summary update fails (caller should catch and handle gracefully)
 *
 * @example
 * // Called from centralized trigger (summaries/triggers/outflowPeriodSummaryTriggers.ts)
 * try {
 *   await updateOutflowPeriodSummary(outflowPeriod);
 *   console.log('✓ Summary updated successfully');
 * } catch (error) {
 *   console.error('⚠️  Summary update failed:', error);
 *   // Don't re-throw - period update succeeds even if summary fails
 * }
 */
export declare function updateOutflowPeriodSummary(periodData: OutflowPeriod): Promise<void>;
//# sourceMappingURL=updateOutflowPeriodSummary.d.ts.map