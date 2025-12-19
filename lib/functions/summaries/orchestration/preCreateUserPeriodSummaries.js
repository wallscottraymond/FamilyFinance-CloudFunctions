"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preCreateUserPeriodSummaries = preCreateUserPeriodSummaries;
const firestore_1 = require("firebase-admin/firestore");
const calculateUserPeriodSummary_1 = require("../utils/calculateUserPeriodSummary");
const types_1 = require("../../../types");
const db = (0, firestore_1.getFirestore)();
/**
 * Pre-creates user period summaries for all period types (weekly, bi-monthly, monthly)
 *
 * This function is called when a new user account is created to pre-populate
 * their period summaries. This ensures instant dashboard loads with minimal
 * Firestore reads on the frontend.
 *
 * Strategy:
 * 1. Query source_periods to find current periods for each type (isCurrent: true)
 * 2. Use the index field to find 12 periods before and 12 periods after
 * 3. Create summaries using the actual periodId values from the database
 *
 * Creates summaries for:
 * - 25 weekly summaries (12 before + current + 12 after)
 * - 25 bi-monthly summaries (12 before + current + 12 after)
 * - 25 monthly summaries (12 before + current + 12 after)
 * Total: 75 period summaries
 *
 * @param userId - The user ID
 * @returns Promise that resolves when all summaries are created
 */
async function preCreateUserPeriodSummaries(userId) {
    console.log(`[preCreateUserPeriodSummaries] Pre-creating summaries for user: ${userId}`);
    const startTime = Date.now();
    try {
        // Process all three period types
        const periodTypes = [
            { type: types_1.PeriodType.WEEKLY, name: "weekly" },
            { type: types_1.PeriodType.BI_MONTHLY, name: "bi-monthly" },
            { type: types_1.PeriodType.MONTHLY, name: "monthly" },
        ];
        // Create a single Firestore batch for all summaries
        const batch = db.batch();
        let summaryCount = 0;
        for (const { type, name } of periodTypes) {
            console.log(`[preCreateUserPeriodSummaries] Processing ${name} periods for user: ${userId}`);
            // Step 1: Find the current period for this type
            const currentPeriodQuery = await db
                .collection("source_periods")
                .where("type", "==", type)
                .where("isCurrent", "==", true)
                .limit(1)
                .get();
            if (currentPeriodQuery.empty) {
                console.warn(`[preCreateUserPeriodSummaries] No current ${name} period found in source_periods`);
                continue;
            }
            const currentPeriodDoc = currentPeriodQuery.docs[0];
            const currentPeriod = currentPeriodDoc.data();
            const currentIndex = currentPeriod.index;
            console.log(`[preCreateUserPeriodSummaries] Found current ${name} period: ${currentPeriodDoc.id} (index: ${currentIndex})`);
            // Step 2: Query for 12 periods before and 12 periods after
            const minIndex = currentIndex - 12;
            const maxIndex = currentIndex + 12;
            const periodsQuery = await db
                .collection("source_periods")
                .where("type", "==", type)
                .where("index", ">=", minIndex)
                .where("index", "<=", maxIndex)
                .orderBy("index", "asc")
                .get();
            console.log(`[preCreateUserPeriodSummaries] Found ${periodsQuery.size} ${name} periods in range ${minIndex}-${maxIndex}`);
            // Step 3: Add each summary to the batch
            for (const periodDoc of periodsQuery.docs) {
                const sourcePeriodId = periodDoc.id; // Use document ID (e.g., "2025M02")
                // Calculate summary data (no Firestore writes)
                const summary = await (0, calculateUserPeriodSummary_1.calculateUserPeriodSummary)(userId, name, // Period type as string
                sourcePeriodId, // Use document ID (no hyphen)
                false // Don't include detailed entries for initial creation
                );
                const summaryId = summary.id;
                const summaryRef = db.collection("user_summaries").doc(summaryId);
                // Add to batch (will create new document)
                batch.set(summaryRef, summary);
                summaryCount++;
                console.log(`[preCreateUserPeriodSummaries] Queued summary: ${summaryId}`);
            }
        }
        // Commit entire batch at once
        console.log(`[preCreateUserPeriodSummaries] Committing batch with ${summaryCount} summaries`);
        await batch.commit();
        const duration = Date.now() - startTime;
        console.log(`[preCreateUserPeriodSummaries] ✓ Successfully created ${summaryCount} summaries in ${duration}ms`, { userId, summaryCount });
    }
    catch (error) {
        console.error(`[preCreateUserPeriodSummaries] Fatal error pre-creating summaries for user ${userId}:`, error);
        // Don't throw - we don't want to fail user account creation if summary pre-creation fails
    }
}
//# sourceMappingURL=preCreateUserPeriodSummaries.js.map