"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfillUserSummaries = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const updateUserPeriodSummary_1 = require("../orchestration/updateUserPeriodSummary");
const auth_1 = require("../../../utils/auth");
const db = (0, firestore_1.getFirestore)();
/**
 * Admin function to backfill user_summaries for all existing periods
 *
 * This function is used to generate user_summaries for periods that were
 * created before the summary triggers were deployed.
 *
 * Process:
 * 1. Query all unique (userId, periodType, sourcePeriodId) combinations from:
 *    - budget_periods
 *    - outflow_periods
 *    - inflow_periods
 * 2. For each unique combination, call updateUserPeriodSummary()
 * 3. Track progress and report results
 *
 * Usage:
 * POST /backfillUserSummaries
 * Authorization: Bearer <admin_token>
 *
 * Optional query parameters:
 * - dryRun=true: Only count periods, don't create summaries
 * - userId=<userId>: Only process periods for specific user
 */
exports.backfillUserSummaries = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 540, // 9 minutes max
    cors: true,
}, async (request, response) => {
    var _a;
    const startTime = Date.now();
    // Only allow POST requests
    if (request.method !== "POST") {
        response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests allowed"));
        return;
    }
    // Authenticate and require ADMIN role
    const authResult = await (0, auth_1.authMiddleware)(request, auth_1.UserRole.ADMIN);
    if (!authResult.success) {
        response.status(401).json(authResult.error);
        return;
    }
    console.log("[backfillUserSummaries] Starting backfill process...");
    console.log(`[backfillUserSummaries] Authenticated as: ${(_a = authResult.user) === null || _a === void 0 ? void 0 : _a.email}`);
    // Parse optional parameters
    const dryRun = request.query.dryRun === "true";
    const filterUserId = request.query.userId;
    if (dryRun) {
        console.log("[backfillUserSummaries] Running in DRY RUN mode - no summaries will be created");
    }
    if (filterUserId) {
        console.log(`[backfillUserSummaries] Filtering to user: ${filterUserId}`);
    }
    const uniquePeriods = new Map();
    const results = {
        totalProcessed: 0,
        created: 0,
        updated: 0,
        errors: 0,
        skipped: 0,
        budgetPeriodsScanned: 0,
        outflowPeriodsScanned: 0,
        inflowPeriodsScanned: 0,
    };
    try {
        // 1. Collect unique periods from budget_periods
        console.log("[backfillUserSummaries] Scanning budget_periods...");
        let budgetPeriodsQuery = db.collection("budget_periods")
            .where("isActive", "==", true);
        if (filterUserId) {
            budgetPeriodsQuery = budgetPeriodsQuery.where("userId", "==", filterUserId);
        }
        const budgetPeriodsSnap = await budgetPeriodsQuery.get();
        results.budgetPeriodsScanned = budgetPeriodsSnap.size;
        budgetPeriodsSnap.docs.forEach((doc) => {
            const data = doc.data();
            if (data.userId && data.periodType && data.sourcePeriodId) {
                const key = `${data.userId}_${String(data.periodType).toLowerCase()}_${data.sourcePeriodId}`;
                if (!uniquePeriods.has(key)) {
                    uniquePeriods.set(key, {
                        userId: data.userId,
                        periodType: String(data.periodType).toLowerCase(),
                        sourcePeriodId: data.sourcePeriodId,
                    });
                }
            }
        });
        console.log(`[backfillUserSummaries] Found ${budgetPeriodsSnap.size} budget_periods, ` +
            `${uniquePeriods.size} unique periods so far`);
        // 2. Collect unique periods from outflow_periods
        console.log("[backfillUserSummaries] Scanning outflow_periods...");
        let outflowPeriodsQuery = db.collection("outflow_periods")
            .where("isActive", "==", true);
        if (filterUserId) {
            outflowPeriodsQuery = outflowPeriodsQuery.where("ownerId", "==", filterUserId);
        }
        const outflowPeriodsSnap = await outflowPeriodsQuery.get();
        results.outflowPeriodsScanned = outflowPeriodsSnap.size;
        outflowPeriodsSnap.docs.forEach((doc) => {
            const data = doc.data();
            const userId = data.ownerId || data.userId;
            if (userId && data.periodType && data.sourcePeriodId) {
                const key = `${userId}_${String(data.periodType).toLowerCase()}_${data.sourcePeriodId}`;
                if (!uniquePeriods.has(key)) {
                    uniquePeriods.set(key, {
                        userId: userId,
                        periodType: String(data.periodType).toLowerCase(),
                        sourcePeriodId: data.sourcePeriodId,
                    });
                }
            }
        });
        console.log(`[backfillUserSummaries] Found ${outflowPeriodsSnap.size} outflow_periods, ` +
            `${uniquePeriods.size} unique periods so far`);
        // 3. Collect unique periods from inflow_periods
        console.log("[backfillUserSummaries] Scanning inflow_periods...");
        let inflowPeriodsQuery = db.collection("inflow_periods")
            .where("isActive", "==", true);
        if (filterUserId) {
            inflowPeriodsQuery = inflowPeriodsQuery.where("ownerId", "==", filterUserId);
        }
        const inflowPeriodsSnap = await inflowPeriodsQuery.get();
        results.inflowPeriodsScanned = inflowPeriodsSnap.size;
        inflowPeriodsSnap.docs.forEach((doc) => {
            const data = doc.data();
            const userId = data.ownerId || data.userId;
            if (userId && data.periodType && data.sourcePeriodId) {
                const key = `${userId}_${String(data.periodType).toLowerCase()}_${data.sourcePeriodId}`;
                if (!uniquePeriods.has(key)) {
                    uniquePeriods.set(key, {
                        userId: userId,
                        periodType: String(data.periodType).toLowerCase(),
                        sourcePeriodId: data.sourcePeriodId,
                    });
                }
            }
        });
        console.log(`[backfillUserSummaries] Found ${inflowPeriodsSnap.size} inflow_periods, ` +
            `${uniquePeriods.size} unique periods total`);
        // If dry run, return counts without processing
        if (dryRun) {
            const periodsArray = Array.from(uniquePeriods.values());
            const periodTypeCounts = periodsArray.reduce((acc, p) => {
                acc[p.periodType] = (acc[p.periodType] || 0) + 1;
                return acc;
            }, {});
            response.status(200).json((0, auth_1.createSuccessResponse)(Object.assign({ dryRun: true, message: "Dry run complete - no summaries were created", totalUniquePeriods: uniquePeriods.size, periodTypeCounts }, results)));
            return;
        }
        // 4. Generate summaries for each unique period
        const periodsArray = Array.from(uniquePeriods.values());
        console.log(`[backfillUserSummaries] Processing ${periodsArray.length} unique periods...`);
        for (let i = 0; i < periodsArray.length; i++) {
            const period = periodsArray[i];
            results.totalProcessed++;
            // Log progress every 50 periods
            if (results.totalProcessed % 50 === 0) {
                console.log(`[backfillUserSummaries] Progress: ${results.totalProcessed}/${periodsArray.length} ` +
                    `(created: ${results.created}, updated: ${results.updated}, errors: ${results.errors})`);
            }
            try {
                // Check if summary already exists
                const summaryId = `${period.userId}_${period.periodType}_${period.sourcePeriodId}`;
                const existingSnap = await db.collection("user_summaries").doc(summaryId).get();
                const wasExisting = existingSnap.exists;
                // Create or update the summary
                await (0, updateUserPeriodSummary_1.updateUserPeriodSummary)(period.userId, period.periodType, period.sourcePeriodId, true // Always include entries
                );
                if (wasExisting) {
                    results.updated++;
                }
                else {
                    results.created++;
                }
                // Small delay to avoid overwhelming Firestore (50ms between operations)
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            catch (error) {
                console.error(`[backfillUserSummaries] Error processing ${period.sourcePeriodId}:`, error instanceof Error ? error.message : error);
                results.errors++;
            }
        }
        const duration = Date.now() - startTime;
        console.log(`[backfillUserSummaries] Completed in ${duration}ms:`, results);
        response.status(200).json((0, auth_1.createSuccessResponse)(Object.assign({ message: "Backfill complete", durationMs: duration }, results)));
    }
    catch (error) {
        console.error("[backfillUserSummaries] Fatal error:", error);
        response.status(500).json((0, auth_1.createErrorResponse)("internal", `Backfill failed: ${error instanceof Error ? error.message : String(error)}`));
    }
});
//# sourceMappingURL=backfillUserSummaries.js.map