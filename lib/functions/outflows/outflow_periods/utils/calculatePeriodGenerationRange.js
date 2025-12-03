"use strict";
/**
 * Calculate the date range for outflow period generation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePeriodGenerationRange = calculatePeriodGenerationRange;
/**
 * Calculate the date range for outflow period generation
 *
 * @param outflow - The recurring outflow (supports both flat and nested structure)
 * @param monthsForward - Number of months to generate forward from now (default: 15)
 * @returns Object with startDate and endDate
 */
function calculatePeriodGenerationRange(outflow, monthsForward = 15) {
    // Start from firstDate to capture historical periods
    const startDate = outflow.firstDate.toDate();
    // Extend N months forward from now
    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + monthsForward);
    return { startDate, endDate };
}
//# sourceMappingURL=calculatePeriodGenerationRange.js.map