"use strict";
/**
 * Batch Update Outflow Period Summaries
 *
 * Efficiently updates multiple outflow period entries in user_summaries.
 * Groups updates by summary document to minimize transactions.
 *
 * Use this instead of calling updateOutflowPeriodSummary() multiple times
 * when processing bulk updates (e.g., 10+ periods at once).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.batchUpdateOutflowPeriodSummaries = batchUpdateOutflowPeriodSummaries;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const periodTypeHelpers_1 = require("../utils/periodTypeHelpers");
/**
 * Batch update multiple outflow period summaries
 *
 * @param periods - Array of OutflowPeriod objects to update
 * @returns Summary of results (success/failure counts)
 */
async function batchUpdateOutflowPeriodSummaries(periods) {
    console.log(`[batchUpdateOutflowPeriodSummaries] Processing ${periods.length} periods`);
    const db = admin.firestore();
    const results = {
        success: 0,
        failed: 0,
        errors: []
    };
    try {
        // Step 1: Fetch all parent outflows (in parallel)
        const outflowPromises = periods.map(async (period) => {
            try {
                const outflowDoc = await db.collection('outflows').doc(period.outflowId).get();
                if (!outflowDoc.exists) {
                    console.warn(`[batchUpdateOutflowPeriodSummaries] ⚠️  Outflow ${period.outflowId} not found`);
                    return null;
                }
                return {
                    period,
                    outflow: outflowDoc.data()
                };
            }
            catch (error) {
                console.error(`[batchUpdateOutflowPeriodSummaries] Error fetching outflow ${period.outflowId}:`, error);
                return null;
            }
        });
        const periodsWithOutflows = (await Promise.all(outflowPromises))
            .filter((item) => item !== null);
        // Step 2: Group periods by summary document ID
        const periodsBySummaryId = new Map();
        for (const item of periodsWithOutflows) {
            const periodType = (0, periodTypeHelpers_1.determinePeriodType)(item.period.sourcePeriodId);
            const summaryId = `${item.period.ownerId}_${periodType.toLowerCase()}_${item.period.sourcePeriodId}`;
            if (!periodsBySummaryId.has(summaryId)) {
                periodsBySummaryId.set(summaryId, []);
            }
            periodsBySummaryId.get(summaryId).push(item);
        }
        console.log(`[batchUpdateOutflowPeriodSummaries] Grouped into ${periodsBySummaryId.size} summary documents`);
        // Step 3: Update each summary document (one transaction per document)
        const updatePromises = Array.from(periodsBySummaryId.entries()).map(async ([summaryId, items]) => {
            try {
                await updateSingleSummaryDocument(db, summaryId, items);
                results.success += items.length;
                console.log(`[batchUpdateOutflowPeriodSummaries] ✓ Updated ${items.length} entries in ${summaryId}`);
            }
            catch (error) {
                results.failed += items.length;
                items.forEach(item => {
                    results.errors.push({
                        periodId: item.period.id,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                });
                console.error(`[batchUpdateOutflowPeriodSummaries] ❌ Failed to update ${summaryId}:`, error);
            }
        });
        await Promise.all(updatePromises);
        console.log(`[batchUpdateOutflowPeriodSummaries] Complete: ${results.success} success, ${results.failed} failed`);
        return results;
    }
    catch (error) {
        console.error('[batchUpdateOutflowPeriodSummaries] ❌ Fatal error:', error);
        throw error;
    }
}
/**
 * Update a single summary document with multiple period entries
 * Uses a transaction to ensure atomicity
 */
async function updateSingleSummaryDocument(db, summaryId, items) {
    const summaryRef = db.collection('user_summaries').doc(summaryId);
    const now = firestore_1.Timestamp.now();
    await db.runTransaction(async (transaction) => {
        const summaryDoc = await transaction.get(summaryRef);
        let outflowsArray = [];
        if (summaryDoc.exists) {
            const summaryData = summaryDoc.data();
            outflowsArray = (summaryData === null || summaryData === void 0 ? void 0 : summaryData.outflows) || [];
        }
        // Update or add each period entry
        for (const { period, outflow } of items) {
            const updatedEntry = buildOutflowEntry(period, outflow);
            const entryIndex = outflowsArray.findIndex(entry => entry.outflowPeriodId === period.id);
            if (entryIndex >= 0) {
                outflowsArray[entryIndex] = updatedEntry;
            }
            else {
                outflowsArray.push(updatedEntry);
            }
        }
        // Write back to Firestore
        if (summaryDoc.exists) {
            transaction.update(summaryRef, {
                outflows: outflowsArray,
                updatedAt: now,
                lastRecalculated: now
            });
        }
        else {
            // Create new document (use first period for metadata)
            const firstPeriod = items[0].period;
            const periodType = (0, periodTypeHelpers_1.determinePeriodType)(firstPeriod.sourcePeriodId);
            transaction.set(summaryRef, {
                id: summaryId,
                userId: firstPeriod.ownerId,
                sourcePeriodId: firstPeriod.sourcePeriodId,
                periodType: periodType,
                periodStartDate: firstPeriod.periodStartDate,
                periodEndDate: firstPeriod.periodEndDate,
                year: firstPeriod.periodStartDate.toDate().getFullYear(),
                month: firstPeriod.periodStartDate.toDate().getMonth() + 1,
                outflows: outflowsArray,
                budgets: [],
                inflows: [],
                goals: [],
                lastRecalculated: now,
                createdAt: now,
                updatedAt: now
            });
        }
    });
}
/**
 * Build OutflowEntry from OutflowPeriod + Outflow data
 * (Duplicated from updateOutflowPeriodSummary.ts for independence)
 */
function buildOutflowEntry(period, outflow) {
    const paymentProgressPercentage = period.totalAmountDue > 0
        ? Math.round((period.totalAmountPaid / period.totalAmountDue) * 100)
        : 0;
    return {
        outflowPeriodId: period.id,
        outflowId: outflow.id,
        groupId: period.groupId || '',
        merchant: outflow.merchantName || outflow.description || 'Unknown',
        userCustomName: outflow.userCustomName || outflow.merchantName || outflow.description || 'Unknown',
        description: outflow.description || outflow.merchantName || 'Unknown',
        totalAmountDue: period.totalAmountDue || 0,
        totalAmountPaid: period.totalAmountPaid || 0,
        totalAmountUnpaid: period.totalAmountUnpaid || 0,
        totalAmountWithheld: period.amountWithheld || 0,
        averageAmount: period.averageAmount || 0,
        isDuePeriod: period.isDuePeriod || false,
        duePeriodCount: period.isDuePeriod ? 1 : 0,
        dueDate: period.dueDate,
        status: period.status || types_1.OutflowPeriodStatus.PENDING,
        paymentProgressPercentage,
        fullyPaidCount: period.isFullyPaid ? 1 : 0,
        unpaidCount: (!period.isFullyPaid && !period.isPartiallyPaid) ? 1 : 0,
        itemCount: 1
    };
}
//# sourceMappingURL=batchUpdateOutflowPeriodSummaries.js.map