"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batchUpdateUserPeriodSummaries = batchUpdateUserPeriodSummaries;
exports.batchUpdateUserPeriodSummariesFromOutflowPeriods = batchUpdateUserPeriodSummariesFromOutflowPeriods;
const firestore_1 = require("firebase-admin/firestore");
const updateUserPeriodSummary_1 = require("../orchestration/updateUserPeriodSummary");
const db = (0, firestore_1.getFirestore)();
/**
 * Batch update user period summaries for multiple periods
 *
 * This function is called when multiple periods are created at once (e.g., when
 * an outflow is created and generates 25 periods). Instead of triggering 25
 * individual summary updates, this batches them by unique period.
 *
 * @param userId - The user ID
 * @param periodIds - Array of source period IDs that need summary updates
 * @param periodType - The period type (e.g., "monthly")
 * @returns Count of summaries updated
 */
async function batchUpdateUserPeriodSummaries(userId, periodIds, periodType) {
    console.log(`[batchUpdateUserPeriodSummaries] Batch updating ${periodIds.length} summaries for user: ${userId}`);
    const startTime = Date.now();
    // Get unique period IDs (in case of duplicates)
    const uniquePeriodIds = [...new Set(periodIds)];
    console.log(`[batchUpdateUserPeriodSummaries] Unique periods to update: ${uniquePeriodIds.length}`);
    // Update all summaries in parallel
    const updatePromises = uniquePeriodIds.map((sourcePeriodId) => (0, updateUserPeriodSummary_1.updateUserPeriodSummary)(userId, periodType, sourcePeriodId, false).catch((error) => {
        console.error(`[batchUpdateUserPeriodSummaries] Error updating summary for period ${sourcePeriodId}:`, error);
        return null; // Don't fail the entire batch
    }));
    const results = await Promise.all(updatePromises);
    const successCount = results.filter((r) => r !== null).length;
    const failedCount = results.length - successCount;
    const duration = Date.now() - startTime;
    console.log(`[batchUpdateUserPeriodSummaries] Completed in ${duration}ms`, {
        totalPeriods: uniquePeriodIds.length,
        successful: successCount,
        failed: failedCount,
    });
    return successCount;
}
/**
 * Batch update user period summaries from outflow period documents
 *
 * Extracts period information from outflow_period documents and updates summaries.
 * Groups periods by period type to batch updates efficiently.
 *
 * @param userId - The user ID
 * @param outflowPeriodIds - Array of outflow_period document IDs
 * @returns Count of summaries updated
 */
async function batchUpdateUserPeriodSummariesFromOutflowPeriods(userId, outflowPeriodIds) {
    console.log(`[batchUpdateUserPeriodSummariesFromOutflowPeriods] Fetching ${outflowPeriodIds.length} outflow periods`);
    // Fetch all outflow period documents
    const periodDocs = await Promise.all(outflowPeriodIds.map((id) => db.collection("outflow_periods").doc(id).get()));
    // Group by period type
    const periodsByType = new Map();
    for (const doc of periodDocs) {
        if (!doc.exists)
            continue;
        const period = doc.data();
        const periodType = String(period.periodType).toLowerCase();
        const sourcePeriodId = period.sourcePeriodId;
        if (!periodsByType.has(periodType)) {
            periodsByType.set(periodType, new Set());
        }
        periodsByType.get(periodType).add(sourcePeriodId);
    }
    console.log(`[batchUpdateUserPeriodSummariesFromOutflowPeriods] Grouped into ${periodsByType.size} period types`);
    // Update each period type in parallel
    const updatePromises = [];
    for (const [periodType, sourcePeriodIds] of periodsByType.entries()) {
        console.log(`[batchUpdateUserPeriodSummariesFromOutflowPeriods] Updating ${sourcePeriodIds.size} ${periodType} summaries`);
        updatePromises.push(batchUpdateUserPeriodSummaries(userId, Array.from(sourcePeriodIds), periodType));
    }
    const results = await Promise.all(updatePromises);
    const totalUpdated = results.reduce((sum, count) => sum + count, 0);
    console.log(`[batchUpdateUserPeriodSummariesFromOutflowPeriods] Total summaries updated: ${totalUpdated}`);
    return totalUpdated;
}
//# sourceMappingURL=batchUpdateUserPeriodSummaries.js.map