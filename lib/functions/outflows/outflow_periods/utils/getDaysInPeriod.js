"use strict";
/**
 * Calculate days in a period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDaysInPeriod = getDaysInPeriod;
const period_generation_service_1 = require("../../../domain/budgets/period_generation.service");
/**
 * Helper function to calculate days in a period
 */
function getDaysInPeriod(startDate, endDate) {
    // UTC-normalized inclusive day count (Code-Health-Review M1-M4: ceil on a 23:59:59 end gave October 32 days).
    return (0, period_generation_service_1.count_days_inclusive)(startDate.toDate(), endDate.toDate());
}
//# sourceMappingURL=getDaysInPeriod.js.map