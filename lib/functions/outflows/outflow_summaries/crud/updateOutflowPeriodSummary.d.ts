/**
 * Update Outflow Period Summary
 *
 * Updates user_summaries document when an outflow period is updated.
 * Called from onOutflowPeriodUpdate trigger.
 *
 * Per-user design: Each user has separate summary documents, so updates
 * won't block each other even under heavy concurrent load.
 */
import { OutflowPeriod } from '../../../../types';
/**
 * Update a single outflow entry in the user's summary document
 *
 * @param periodData - The updated outflow period data
 */
export declare function updateOutflowPeriodSummary(periodData: OutflowPeriod): Promise<void>;
//# sourceMappingURL=updateOutflowPeriodSummary.d.ts.map