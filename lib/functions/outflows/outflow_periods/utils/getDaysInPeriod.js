"use strict";
/**
 * Calculate days in a period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDaysInPeriod = getDaysInPeriod;
/**
 * Helper function to calculate days in a period
 */
function getDaysInPeriod(startDate, endDate) {
    const start = startDate.toDate();
    const end = endDate.toDate();
    const diffMs = end.getTime() - start.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end day
}
//# sourceMappingURL=getDaysInPeriod.js.map