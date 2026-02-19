"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateInflowSummary = calculateInflowSummary;
/**
 * Calculate days until a date from now
 */
function calculateDaysUntil(date) {
    if (!date)
        return 0;
    const targetDate = date.toDate();
    const now = new Date();
    const diffMs = targetDate.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}
/**
 * Determine confidence level based on income type and data quality
 */
function determineConfidenceLevel(isRegularSalary, hasPlaidPrediction) {
    if (isRegularSalary && hasPlaidPrediction)
        return 'high';
    if (isRegularSalary)
        return 'high';
    if (hasPlaidPrediction)
        return 'medium';
    return 'low';
}
/**
 * Calculates inflow entries from inflow periods
 *
 * Converts inflow periods into an array of inflow entries for frontend display.
 * Now includes occurrence tracking and payment prediction data.
 * Frontend calculates aggregated totals on-the-fly for better performance.
 *
 * @param inflowPeriods - Array of inflow periods to convert
 * @returns Array of InflowEntry objects
 */
function calculateInflowSummary(inflowPeriods) {
    console.log(`[calculateInflowSummary] Converting ${inflowPeriods.length} inflow periods to entries`);
    // Build entries array directly (one entry per period)
    const entries = inflowPeriods.map(inflowPeriod => {
        var _a;
        // Calculate amounts
        const expectedAmount = inflowPeriod.totalAmountDue || 0;
        const receivedAmount = inflowPeriod.totalAmountPaid || 0;
        const pendingAmount = expectedAmount - receivedAmount;
        // Determine if this is regular salary based on Plaid category or explicit flag
        const plaidCategory = ((_a = inflowPeriod.plaidDetailedCategory) === null || _a === void 0 ? void 0 : _a.toUpperCase()) || "";
        const isRegularSalary = inflowPeriod.isRegularSalary === true ||
            plaidCategory.includes("WAGES") ||
            plaidCategory.includes("SALARY");
        // Determine income type based on Plaid category
        let incomeType = "other";
        if (plaidCategory.includes("WAGES") || plaidCategory.includes("SALARY")) {
            incomeType = "salary";
        }
        else if (plaidCategory.includes("FREELANCE") || plaidCategory.includes("CONTRACT")) {
            incomeType = "freelance";
        }
        else if (plaidCategory.includes("INVESTMENT") || plaidCategory.includes("DIVIDEND")) {
            incomeType = "investment";
        }
        // Calculate receipt progress percentage (unit count)
        const occurrenceCount = inflowPeriod.numberOfOccurrencesInPeriod || 0;
        const occurrencesPaid = inflowPeriod.numberOfOccurrencesPaid || 0;
        const receiptProgressPercentage = occurrenceCount > 0
            ? Math.round((occurrencesPaid / occurrenceCount) * 100)
            : 0;
        // Calculate dollar progress percentage
        const dollarProgressPercentage = expectedAmount > 0
            ? Math.round((receivedAmount / expectedAmount) * 100)
            : 0;
        // Build prediction data if we have relevant info
        let nextPaymentPrediction;
        const hasPlaidPrediction = !!inflowPeriod.predictedNextDate;
        const nextDate = inflowPeriod.nextUnpaidDueDate || inflowPeriod.predictedNextDate;
        if (nextDate && !inflowPeriod.isFullyPaid) {
            nextPaymentPrediction = {
                expectedDate: nextDate,
                expectedAmount: inflowPeriod.amountPerOccurrence || inflowPeriod.averageAmount || 0,
                confidenceLevel: determineConfidenceLevel(isRegularSalary, hasPlaidPrediction),
                predictionMethod: hasPlaidPrediction ? 'plaid' : 'frequency',
                daysUntilPayment: calculateDaysUntil(nextDate)
            };
        }
        return {
            // === IDENTITY ===
            inflowId: inflowPeriod.inflowId,
            inflowPeriodId: inflowPeriod.id,
            description: inflowPeriod.description || "Unknown",
            source: inflowPeriod.merchant || inflowPeriod.payee || inflowPeriod.source || "Unknown",
            userCustomName: inflowPeriod.userCustomName || undefined,
            // === AMOUNTS ===
            totalExpected: expectedAmount,
            totalReceived: receivedAmount,
            totalPending: pendingAmount,
            averageAmount: inflowPeriod.averageAmount || 0,
            amountPerOccurrence: inflowPeriod.amountPerOccurrence || inflowPeriod.averageAmount || 0,
            // === STATUS ===
            isReceiptPeriod: inflowPeriod.isReceiptPeriod,
            expectedDate: inflowPeriod.predictedNextDate || undefined,
            isRegularSalary,
            // === PROGRESS METRICS ===
            receiptProgressPercentage,
            dollarProgressPercentage,
            isFullyReceived: inflowPeriod.isFullyPaid || false,
            isPending: pendingAmount > 0,
            // === OCCURRENCE TRACKING ===
            occurrenceCount,
            occurrencesPaid,
            occurrenceDueDates: inflowPeriod.occurrenceDueDates || [],
            firstDueDateInPeriod: inflowPeriod.firstDueDateInPeriod || undefined,
            lastDueDateInPeriod: inflowPeriod.lastDueDateInPeriod || undefined,
            nextUnpaidDueDate: inflowPeriod.nextUnpaidDueDate || undefined,
            // === PREDICTION ===
            nextPaymentPrediction,
            // === GROUPING ===
            groupId: inflowPeriod.groupId || "",
            // === INCOME TYPE ===
            incomeType,
        };
    });
    console.log(`[calculateInflowSummary] Converted ${entries.length} entries`);
    console.log(`[calculateInflowSummary] Entries with predictions: ${entries.filter(e => e.nextPaymentPrediction).length}`);
    return entries;
}
//# sourceMappingURL=calculateInflowSummary.js.map