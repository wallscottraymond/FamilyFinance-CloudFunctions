"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateInflowSummary = calculateInflowSummary;
/**
 * Calculates inflow entries from inflow periods
 *
 * Converts inflow periods into an array of inflow entries for frontend display.
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
        // Determine if this is regular salary based on Plaid category
        const plaidCategory = ((_a = inflowPeriod.plaidDetailedCategory) === null || _a === void 0 ? void 0 : _a.toUpperCase()) || "";
        const isRegularSalary = plaidCategory.includes("WAGES") || plaidCategory.includes("SALARY");
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
        // Calculate receipt progress percentage
        const receiptProgressPercentage = expectedAmount > 0
            ? Math.round((receivedAmount / expectedAmount) * 100)
            : 0;
        return {
            // === IDENTITY ===
            inflowId: inflowPeriod.inflowId,
            inflowPeriodId: inflowPeriod.id,
            description: inflowPeriod.description || "Unknown",
            source: inflowPeriod.merchant || inflowPeriod.source || "Unknown",
            // === AMOUNTS ===
            totalExpected: expectedAmount,
            totalReceived: receivedAmount,
            totalPending: pendingAmount,
            averageAmount: inflowPeriod.averageAmount || 0,
            // === STATUS ===
            isReceiptPeriod: inflowPeriod.isReceiptPeriod,
            expectedDate: inflowPeriod.predictedNextDate || undefined,
            isRegularSalary,
            // === PROGRESS METRICS ===
            receiptProgressPercentage,
            isFullyReceived: inflowPeriod.isFullyPaid || false,
            isPending: pendingAmount > 0,
            // === GROUPING ===
            groupId: inflowPeriod.groupId || "",
            // === INCOME TYPE ===
            incomeType,
        };
    });
    console.log(`[calculateInflowSummary] Converted ${entries.length} entries`);
    return entries;
}
//# sourceMappingURL=calculateInflowSummary.js.map