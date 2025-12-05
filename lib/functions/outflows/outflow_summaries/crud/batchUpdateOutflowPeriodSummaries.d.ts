/**
 * Batch Update Outflow Period Summaries
 *
 * Efficiently updates multiple outflow period entries in user_summaries.
 * Groups updates by summary document to minimize transactions.
 *
 * Use this instead of calling updateOutflowPeriodSummary() multiple times
 * when processing bulk updates (e.g., 10+ periods at once).
 */
import { OutflowPeriod } from '../../../../types';
/**
 * Batch update multiple outflow period summaries
 *
 * @param periods - Array of OutflowPeriod objects to update
 * @returns Summary of results (success/failure counts)
 */
export declare function batchUpdateOutflowPeriodSummaries(periods: OutflowPeriod[]): Promise<{
    success: number;
    failed: number;
    errors: Array<{
        periodId: string;
        error: string;
    }>;
}>;
//# sourceMappingURL=batchUpdateOutflowPeriodSummaries.d.ts.map