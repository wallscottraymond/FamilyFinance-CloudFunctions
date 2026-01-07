import { InflowPeriod } from "../../../types";
import { InflowEntry } from "../types/periodSummaries";
/**
 * Calculates inflow entries from inflow periods
 *
 * Converts inflow periods into an array of inflow entries for frontend display.
 * Frontend calculates aggregated totals on-the-fly for better performance.
 *
 * @param inflowPeriods - Array of inflow periods to convert
 * @returns Array of InflowEntry objects
 */
export declare function calculateInflowSummary(inflowPeriods: InflowPeriod[]): InflowEntry[];
//# sourceMappingURL=calculateInflowSummary.d.ts.map