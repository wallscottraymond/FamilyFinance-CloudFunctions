"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateOutflowSummary = calculateOutflowSummary;
const types_1 = require("../../../types");
/**
 * Calculates outflow summary data from outflow periods
 *
 * Aggregates all outflow periods for a given period into a summary object
 * containing totals, counts, status breakdowns, and optional detailed entries.
 *
 * @param outflowPeriods - Array of outflow periods to aggregate
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns OutflowSummaryData object
 */
function calculateOutflowSummary(outflowPeriods, includeEntries = true // ALWAYS include entries for tile rendering
) {
    console.log(`[calculateOutflowSummary] Calculating summary for ${outflowPeriods.length} outflow periods`);
    // Initialize totals
    let totalAmountDue = 0;
    let totalAmountPaid = 0;
    let totalAmountWithheld = 0;
    // Initialize counts
    let totalCount = 0;
    let duePeriodCount = 0;
    let fullyPaidCount = 0;
    let unpaidCount = 0;
    // Initialize status counts
    const statusCounts = {};
    // Initialize entries array if requested
    const entries = [];
    // Process each outflow period
    for (const outflowPeriod of outflowPeriods) {
        // Accumulate totals
        totalAmountDue += outflowPeriod.totalAmountDue || 0;
        totalAmountPaid += outflowPeriod.totalAmountPaid || 0;
        totalAmountWithheld += outflowPeriod.amountWithheld || 0;
        // Increment counts
        totalCount++;
        if (outflowPeriod.isDuePeriod) {
            duePeriodCount++;
        }
        if (outflowPeriod.isFullyPaid) {
            fullyPaidCount++;
        }
        if (outflowPeriod.totalAmountUnpaid > 0) {
            unpaidCount++;
        }
        // Count status
        const status = outflowPeriod.status;
        if (status) {
            // Normalize status to match summary format
            let summaryStatus;
            switch (status) {
                case types_1.OutflowPeriodStatus.PAID:
                case types_1.OutflowPeriodStatus.PAID_EARLY:
                    summaryStatus = "PAID";
                    break;
                case types_1.OutflowPeriodStatus.OVERDUE:
                    summaryStatus = "OVERDUE";
                    break;
                case types_1.OutflowPeriodStatus.DUE_SOON:
                    summaryStatus = "DUE_SOON";
                    break;
                case types_1.OutflowPeriodStatus.PENDING:
                    summaryStatus = "PENDING";
                    break;
                case types_1.OutflowPeriodStatus.PARTIAL:
                    summaryStatus = "PARTIAL";
                    break;
                default:
                    summaryStatus = "NOT_DUE";
            }
            statusCounts[summaryStatus] = (statusCounts[summaryStatus] || 0) + 1;
        }
        // Build detailed entry if requested (now always true)
        if (includeEntries) {
            const entry = {
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
            };
            entries.push(entry);
        }
    }
    const summary = {
        totalAmountDue,
        totalAmountPaid,
        totalAmountWithheld,
        totalCount,
        duePeriodCount,
        fullyPaidCount,
        unpaidCount,
        statusCounts,
    };
    // Add entries if requested
    if (includeEntries) {
        summary.entries = entries;
    }
    console.log(`[calculateOutflowSummary] Summary calculated:`, {
        totalAmountDue,
        totalAmountPaid,
        totalAmountWithheld,
        totalCount,
        duePeriodCount,
        fullyPaidCount,
        unpaidCount,
        statusCounts,
        entriesCount: entries.length,
    });
    return summary;
}
//# sourceMappingURL=calculateOutflowSummary.js.map