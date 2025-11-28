import { OutflowPeriod } from "../../../types";
import { OutflowSummaryData } from "../../../types/periodSummaries";
/**
 * Calculates outflow summary data from outflow periods
 *
 * Aggregates all outflow periods for a given period into a summary object
 * containing totals, counts, status breakdowns, and optional detailed entries.
 *
 * @param outflowPeriods - Array of outflow periods to aggregate
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns OutflowSummaryData object
 */
export declare function calculateOutflowSummary(outflowPeriods: OutflowPeriod[], includeEntries?: boolean): OutflowSummaryData;
//# sourceMappingURL=calculateOutflowSummary.d.ts.map