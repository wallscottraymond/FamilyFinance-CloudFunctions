"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateOutflowSummary = calculateOutflowSummary;
const types_1 = require("../../../types");
/**
 * Calculates outflow entries from outflow periods
 *
 * Converts outflow periods into an array of outflow entries for frontend display.
 * Frontend calculates aggregated totals on-the-fly for better performance.
 *
 * @param outflowPeriods - Array of outflow periods to convert
 * @returns Array of OutflowEntry objects
 */
function calculateOutflowSummary(outflowPeriods) {
    console.log(`[calculateOutflowSummary] Converting ${outflowPeriods.length} outflow periods to entries`);
    // Build entries array directly (one entry per period)
    const entries = outflowPeriods.map(outflowPeriod => ({
        // === IDENTITY ===
        outflowId: outflowPeriod.outflowId,
        outflowPeriodId: outflowPeriod.id,
        description: outflowPeriod.description || "Unknown",
        merchant: outflowPeriod.merchant || "Unknown",
        userCustomName: outflowPeriod.userCustomName || undefined,
        // === AMOUNTS ===
        totalAmountDue: outflowPeriod.totalAmountDue || 0,
        totalAmountPaid: outflowPeriod.totalAmountPaid || 0,
        totalAmountUnpaid: outflowPeriod.totalAmountUnpaid || 0,
        totalAmountWithheld: outflowPeriod.amountWithheld || 0,
        averageAmount: outflowPeriod.averageAmount || 0,
        // === STATUS ===
        isDuePeriod: outflowPeriod.isDuePeriod,
        duePeriodCount: outflowPeriod.isDuePeriod ? 1 : 0,
        dueDate: outflowPeriod.dueDate || outflowPeriod.predictedNextDate || undefined,
        status: outflowPeriod.status || types_1.OutflowPeriodStatus.PENDING,
        // === PROGRESS METRICS ===
        paymentProgressPercentage: outflowPeriod.paymentProgressPercentage || 0,
        fullyPaidCount: outflowPeriod.numberOfOccurrencesPaid || 0,
        unpaidCount: outflowPeriod.numberOfOccurrencesUnpaid || 0,
        itemCount: outflowPeriod.numberOfOccurrencesInPeriod || 1,
        // === GROUPING ===
        groupId: outflowPeriod.groupId || "",
    }));
    console.log(`[calculateOutflowSummary] Converted ${entries.length} entries`);
    return entries;
}
//# sourceMappingURL=calculateOutflowSummary.js.map