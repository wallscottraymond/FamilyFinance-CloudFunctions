/**
 * Period Type Helper Utilities
 *
 * Shared utilities for determining period types from source period IDs.
 */
import { PeriodType } from '../../../../types';
/**
 * Determine PeriodType from sourcePeriodId format
 *
 * Parses the source period ID format to identify the period type.
 *
 * Source period ID formats (from generateSourcePeriods.ts):
 * - Monthly: "2025M01" (no hyphen)
 * - Bi-Monthly: "2025BM01A" or "2025BM01B" (no hyphen)
 * - Weekly: "2025W01" (no hyphen)
 *
 * @param sourcePeriodId - Source period identifier (e.g., "2025M01", "2025BM01A", "2025W01")
 * @returns The corresponding PeriodType enum value
 *
 * @example
 * determinePeriodType("2025M01")      // Returns PeriodType.MONTHLY
 * determinePeriodType("2025BM01A")    // Returns PeriodType.BI_MONTHLY
 * determinePeriodType("2025W15")      // Returns PeriodType.WEEKLY
 */
export declare function determinePeriodType(sourcePeriodId: string): PeriodType;
//# sourceMappingURL=periodTypeHelpers.d.ts.map