import { InflowPeriod } from "../../../types";
import { InflowSummaryData } from "../../../types/periodSummaries";
/**
 * Calculates inflow summary data from inflow periods
 *
 * Aggregates all inflow periods for a given period into a summary object
 * containing totals, counts, and optional detailed entries.
 *
 * @param inflowPeriods - Array of inflow periods to aggregate
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns InflowSummaryData object
 */
export declare function calculateInflowSummary(inflowPeriods: InflowPeriod[], includeEntries?: boolean): InflowSummaryData;
//# sourceMappingURL=calculateInflowSummary.d.ts.map