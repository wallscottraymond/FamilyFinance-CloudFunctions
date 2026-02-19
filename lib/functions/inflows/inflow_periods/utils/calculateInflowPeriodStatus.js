"use strict";
/**
 * Calculate Inflow Period Status Utility
 *
 * Determines the status of an inflow period based on:
 * - Whether period has income due
 * - How many occurrences have been received
 * - Due dates vs current date
 *
 * Status Priority (highest to lowest):
 * 1. NOT_EXPECTED - No income expected this period
 * 2. RECEIVED - All occurrences received
 * 3. PARTIAL - Some occurrences received
 * 4. OVERDUE - Expected date passed, not received
 * 5. PENDING - Expecting income, not yet received
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InflowPeriodStatus = void 0;
exports.calculateInflowPeriodStatus = calculateInflowPeriodStatus;
exports.getStatusDisplayProperties = getStatusDisplayProperties;
/**
 * Inflow period status enum
 */
var InflowPeriodStatus;
(function (InflowPeriodStatus) {
    InflowPeriodStatus["RECEIVED"] = "received";
    InflowPeriodStatus["PARTIAL"] = "partial";
    InflowPeriodStatus["PENDING"] = "pending";
    InflowPeriodStatus["OVERDUE"] = "overdue";
    InflowPeriodStatus["NOT_EXPECTED"] = "not_expected"; // No income expected this period
})(InflowPeriodStatus || (exports.InflowPeriodStatus = InflowPeriodStatus = {}));
/**
 * Calculate the status of an inflow period
 *
 * Uses occurrence tracking to determine accurate status.
 * Falls back to amount-based calculation if occurrences aren't tracked.
 *
 * @param inflowPeriod - The inflow period to calculate status for
 * @param referenceDate - The date to compare against (default: now)
 * @returns InflowPeriodStatus enum value
 *
 * @example
 * ```typescript
 * // Period with 2 occurrences, 1 received
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.PARTIAL
 *
 * // Period with all occurrences received
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.RECEIVED
 *
 * // Period with no income expected
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.NOT_EXPECTED
 * ```
 */
function calculateInflowPeriodStatus(inflowPeriod, referenceDate = new Date()) {
    var _a, _b, _c, _d;
    // Handle inactive periods
    if (inflowPeriod.isActive === false) {
        return InflowPeriodStatus.NOT_EXPECTED;
    }
    // Get occurrence counts
    const totalOccurrences = (_a = inflowPeriod.numberOfOccurrencesInPeriod) !== null && _a !== void 0 ? _a : 0;
    const paidOccurrences = (_b = inflowPeriod.numberOfOccurrencesPaid) !== null && _b !== void 0 ? _b : 0;
    // Handle no occurrences expected
    if (totalOccurrences === 0) {
        return InflowPeriodStatus.NOT_EXPECTED;
    }
    // Check if fully received
    if (paidOccurrences >= totalOccurrences) {
        return InflowPeriodStatus.RECEIVED;
    }
    // Check if partially received
    const isPartiallyPaid = paidOccurrences > 0 && paidOccurrences < totalOccurrences;
    // Find earliest unpaid due date for overdue check
    let earliestUnpaidDueDate = null;
    // Check occurrence arrays for unpaid occurrences
    if (inflowPeriod.occurrenceDueDates && inflowPeriod.occurrencePaidFlags) {
        for (let i = 0; i < inflowPeriod.occurrenceDueDates.length; i++) {
            const isPaid = (_c = inflowPeriod.occurrencePaidFlags[i]) !== null && _c !== void 0 ? _c : false;
            if (!isPaid) {
                const dueDate = (_d = inflowPeriod.occurrenceDueDates[i]) === null || _d === void 0 ? void 0 : _d.toDate();
                if (dueDate && (!earliestUnpaidDueDate || dueDate < earliestUnpaidDueDate)) {
                    earliestUnpaidDueDate = dueDate;
                }
            }
        }
    }
    else if (inflowPeriod.nextUnpaidDueDate) {
        earliestUnpaidDueDate = inflowPeriod.nextUnpaidDueDate.toDate();
    }
    else if (inflowPeriod.firstDueDateInPeriod) {
        earliestUnpaidDueDate = inflowPeriod.firstDueDateInPeriod.toDate();
    }
    // Check if overdue (with 1 day grace period)
    let isOverdue = false;
    if (earliestUnpaidDueDate) {
        const gracePeriodDays = 1;
        const dueDateWithGrace = new Date(earliestUnpaidDueDate);
        dueDateWithGrace.setDate(dueDateWithGrace.getDate() + gracePeriodDays);
        if (referenceDate > dueDateWithGrace) {
            isOverdue = true;
        }
    }
    // Determine final status
    if (isOverdue) {
        return InflowPeriodStatus.OVERDUE;
    }
    else if (isPartiallyPaid) {
        return InflowPeriodStatus.PARTIAL;
    }
    else {
        return InflowPeriodStatus.PENDING;
    }
}
/**
 * Get status display properties
 *
 * Returns user-friendly display properties for a status.
 *
 * @param status - The inflow period status
 * @returns Display properties (label, color, icon)
 */
function getStatusDisplayProperties(status) {
    switch (status) {
        case InflowPeriodStatus.RECEIVED:
            return {
                label: 'Received',
                color: 'green',
                icon: 'check-circle'
            };
        case InflowPeriodStatus.PARTIAL:
            return {
                label: 'Partial',
                color: 'yellow',
                icon: 'clock'
            };
        case InflowPeriodStatus.PENDING:
            return {
                label: 'Pending',
                color: 'blue',
                icon: 'clock'
            };
        case InflowPeriodStatus.OVERDUE:
            return {
                label: 'Overdue',
                color: 'red',
                icon: 'alert-circle'
            };
        case InflowPeriodStatus.NOT_EXPECTED:
            return {
                label: 'Not Expected',
                color: 'gray',
                icon: 'minus-circle'
            };
        default:
            return {
                label: 'Unknown',
                color: 'gray',
                icon: 'help-circle'
            };
    }
}
exports.default = calculateInflowPeriodStatus;
//# sourceMappingURL=calculateInflowPeriodStatus.js.map