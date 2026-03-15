"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.regenerateAllUserSummaries = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const updateUserPeriodSummary_1 = require("../orchestration/updateUserPeriodSummary");
const db = (0, firestore_1.getFirestore)();
/**
 * Callable API: Regenerate All User Summaries
 *
 * Regenerates all user_summaries for the authenticated user.
 * This is useful when:
 * - Summary data is stale or missing fields
 * - After schema changes to summary types
 * - Debugging summary issues
 *
 * Request Parameters:
 * - periodType: string (optional) - Filter to specific period type (MONTHLY, WEEKLY, BI_MONTHLY)
 *
 * Returns:
 * - success: boolean
 * - totalProcessed: number
 * - created: number
 * - updated: number
 * - errors: number
 * - message: string
 */
exports.regenerateAllUserSummaries = (0, https_1.onCall)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 300,
}, async (request) => {
    var _a;
    // Check authentication
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated to regenerate summaries");
    }
    const userId = request.auth.uid;
    const filterPeriodType = (_a = request.data) === null || _a === void 0 ? void 0 : _a.periodType;
    console.log(`[regenerateAllUserSummaries] Starting for user: ${userId}`);
    if (filterPeriodType) {
        console.log(`[regenerateAllUserSummaries] Filtering to period type: ${filterPeriodType}`);
    }
    const uniquePeriods = new Map();
    const result = {
        totalProcessed: 0,
        created: 0,
        updated: 0,
        errors: 0,
        errorDetails: [],
    };
    try {
        // Collect unique periods from budget_periods
        console.log("[regenerateAllUserSummaries] Scanning budget_periods...");
        const budgetPeriodsSnap = await db.collection("budget_periods")
            .where("userId", "==", userId)
            .where("isActive", "==", true)
            .get();
        budgetPeriodsSnap.docs.forEach((doc) => {
            const data = doc.data();
            if (data.periodType && data.sourcePeriodId) {
                const periodType = String(data.periodType).toLowerCase();
                if (!filterPeriodType || periodType === filterPeriodType.toLowerCase()) {
                    const key = `${periodType}_${data.sourcePeriodId}`;
                    if (!uniquePeriods.has(key)) {
                        uniquePeriods.set(key, {
                            periodType,
                            sourcePeriodId: data.sourcePeriodId,
                        });
                    }
                }
            }
        });
        console.log(`[regenerateAllUserSummaries] Found ${budgetPeriodsSnap.size} budget_periods`);
        // Collect unique periods from outflow_periods
        console.log("[regenerateAllUserSummaries] Scanning outflow_periods...");
        const outflowPeriodsSnap = await db.collection("outflow_periods")
            .where("ownerId", "==", userId)
            .where("isActive", "==", true)
            .get();
        outflowPeriodsSnap.docs.forEach((doc) => {
            const data = doc.data();
            if (data.periodType && data.sourcePeriodId) {
                const periodType = String(data.periodType).toLowerCase();
                if (!filterPeriodType || periodType === filterPeriodType.toLowerCase()) {
                    const key = `${periodType}_${data.sourcePeriodId}`;
                    if (!uniquePeriods.has(key)) {
                        uniquePeriods.set(key, {
                            periodType,
                            sourcePeriodId: data.sourcePeriodId,
                        });
                    }
                }
            }
        });
        console.log(`[regenerateAllUserSummaries] Found ${outflowPeriodsSnap.size} outflow_periods`);
        // Collect unique periods from inflow_periods
        console.log("[regenerateAllUserSummaries] Scanning inflow_periods...");
        const inflowPeriodsSnap = await db.collection("inflow_periods")
            .where("ownerId", "==", userId)
            .where("isActive", "==", true)
            .get();
        inflowPeriodsSnap.docs.forEach((doc) => {
            const data = doc.data();
            if (data.periodType && data.sourcePeriodId) {
                const periodType = String(data.periodType).toLowerCase();
                if (!filterPeriodType || periodType === filterPeriodType.toLowerCase()) {
                    const key = `${periodType}_${data.sourcePeriodId}`;
                    if (!uniquePeriods.has(key)) {
                        uniquePeriods.set(key, {
                            periodType,
                            sourcePeriodId: data.sourcePeriodId,
                        });
                    }
                }
            }
        });
        console.log(`[regenerateAllUserSummaries] Found ${inflowPeriodsSnap.size} inflow_periods`);
        console.log(`[regenerateAllUserSummaries] Total unique periods: ${uniquePeriods.size}`);
        // Regenerate each summary
        const periodsArray = Array.from(uniquePeriods.values());
        for (const period of periodsArray) {
            result.totalProcessed++;
            try {
                // Check if summary already exists
                const summaryId = `${userId}_${period.periodType}_${period.sourcePeriodId}`;
                const existingSnap = await db.collection("user_summaries").doc(summaryId).get();
                const wasExisting = existingSnap.exists;
                // Create or update the summary
                await (0, updateUserPeriodSummary_1.updateUserPeriodSummary)(userId, period.periodType, period.sourcePeriodId, true // Always include entries
                );
                if (wasExisting) {
                    result.updated++;
                }
                else {
                    result.created++;
                }
                // Log progress every 10 periods
                if (result.totalProcessed % 10 === 0) {
                    console.log(`[regenerateAllUserSummaries] Progress: ${result.totalProcessed}/${periodsArray.length}`);
                }
            }
            catch (error) {
                result.errors++;
                const errorMsg = `Failed to process ${period.sourcePeriodId}: ${error instanceof Error ? error.message : String(error)}`;
                result.errorDetails.push(errorMsg);
                console.error(`[regenerateAllUserSummaries] ${errorMsg}`);
            }
        }
        console.log(`[regenerateAllUserSummaries] Completed:`, result);
        return Object.assign(Object.assign({ success: true }, result), { message: `Regenerated ${result.created + result.updated} summaries (${result.created} created, ${result.updated} updated, ${result.errors} errors)` });
    }
    catch (error) {
        console.error("[regenerateAllUserSummaries] Fatal error:", error);
        throw new https_1.HttpsError("internal", `Failed to regenerate summaries: ${error instanceof Error ? error.message : String(error)}`);
    }
});
//# sourceMappingURL=regenerateAllUserSummaries.js.map