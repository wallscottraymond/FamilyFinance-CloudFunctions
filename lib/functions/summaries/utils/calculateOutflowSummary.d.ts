import { OutflowPeriod } from "../../../types";
import { OutflowEntry } from "../../../types/periodSummaries";
/**
 * Calculates outflow entries from outflow periods
 *
 * Converts outflow periods into an array of outflow entries for frontend display.
 * Frontend calculates aggregated totals on-the-fly for better performance.
 *
 * @param outflowPeriods - Array of outflow periods to convert
 * @returns Array of OutflowEntry objects
 */
export declare function calculateOutflowSummary(outflowPeriods: OutflowPeriod[]): OutflowEntry[];
//# sourceMappingURL=calculateOutflowSummary.d.ts.map