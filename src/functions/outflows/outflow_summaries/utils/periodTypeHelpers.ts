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
 * @param sourcePeriodId - Source period identifier (e.g., "2025-M01", "2025-BM01-1", "2025-W01")
 * @returns The corresponding PeriodType enum value
 *
 * @example
 * determinePeriodType("2025-M01")     // Returns PeriodType.MONTHLY
 * determinePeriodType("2025-BM01-1")  // Returns PeriodType.BI_MONTHLY
 * determinePeriodType("2025-W15")     // Returns PeriodType.WEEKLY
 */
export function determinePeriodType(sourcePeriodId: string): PeriodType {
  if (sourcePeriodId.includes('-M') && !sourcePeriodId.includes('-BM')) {
    return PeriodType.MONTHLY;
  } else if (sourcePeriodId.includes('-BM')) {
    return PeriodType.BI_MONTHLY;
  } else if (sourcePeriodId.includes('-W')) {
    return PeriodType.WEEKLY;
  }
  // Default to monthly if unable to determine
  return PeriodType.MONTHLY;
}
