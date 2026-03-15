"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preCreateUserPeriodSummaries = preCreateUserPeriodSummaries;
const firestore_1 = require("firebase-admin/firestore");
const calculateUserPeriodSummary_1 = require("../utils/calculateUserPeriodSummary");
const types_1 = require("../../../types");
const db = (0, firestore_1.getFirestore)();
/**
 * Calculate the proper index for a period N units before/after current
 *
 * Index formats:
 * - Monthly: YYYYMM (e.g., 202502)
 * - Bi-monthly: YYYYMM1 or YYYYMM2 (e.g., 2025021, 2025022)
 * - Weekly: YYYYWW (e.g., 202509)
 *
 * Simple arithmetic (index - 12) doesn't work across year boundaries!
 * 202502 - 12 = 202490 (invalid) instead of 202402 (Feb 2024)
 *
 * @param currentPeriod - The current period to calculate from
 * @param offset - Number of periods to go back (negative) or forward (positive)
 * @param periodType - The type of period
 * @returns The calculated index value
 */
function calculateOffsetIndex(currentPeriod, offset, periodType) {
    const startDate = currentPeriod.startDate.toDate();
    if (periodType === types_1.PeriodType.MONTHLY) {
        // Go back/forward by months
        const newDate = new Date(startDate);
        newDate.setMonth(newDate.getMonth() + offset);
        const year = newDate.getFullYear();
        const month = newDate.getMonth() + 1; // JS months are 0-indexed
        return parseInt(`${year}${String(month).padStart(2, '0')}`);
    }
    else if (periodType === types_1.PeriodType.BI_MONTHLY) {
        // Bi-monthly has 2 periods per month, so offset by half-months
        const currentHalf = currentPeriod.metadata.biMonthlyHalf || 1;
        const totalHalfMonths = (startDate.getMonth() * 2) + currentHalf - 1 + offset;
        // Calculate the new month and half
        const newMonthsFromStart = Math.floor(totalHalfMonths / 2);
        const newHalf = (totalHalfMonths % 2) + 1;
        const newDate = new Date(startDate.getFullYear(), 0, 1); // Start of year
        newDate.setMonth(newMonthsFromStart);
        const year = newDate.getFullYear();
        const month = newDate.getMonth() + 1;
        return parseInt(`${year}${String(month).padStart(2, '0')}${newHalf}`);
    }
    else {
        // Weekly - go back/forward by weeks
        const newDate = new Date(startDate);
        newDate.setDate(newDate.getDate() + (offset * 7));
        const year = newDate.getFullYear();
        // Calculate week number
        const startOfYear = new Date(year, 0, 1);
        const daysSinceYearStart = Math.floor((newDate.getTime() - startOfYear.getTime()) / (24 * 60 * 60 * 1000));
        const weekNumber = Math.ceil((daysSinceYearStart + startOfYear.getDay() + 1) / 7);
        return parseInt(`${year}${String(weekNumber).padStart(2, '0')}`);
    }
}
/**
 * Pre-creates user period summaries for all period types (weekly, bi-monthly, monthly)
 *
 * This function is called when a new user account is created to pre-populate
 * their period summaries. This ensures instant dashboard loads with minimal
 * Firestore reads on the frontend.
 *
 * Strategy:
 * 1. Query source_periods to find current periods for each type (isCurrent: true)
 * 2. Calculate proper index range accounting for year boundaries
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
        // IMPORTANT: Use enum values directly to ensure document IDs match frontend expectations
        const periodTypes = [
            { type: types_1.PeriodType.WEEKLY, name: types_1.PeriodType.WEEKLY }, // "weekly"
            { type: types_1.PeriodType.BI_MONTHLY, name: types_1.PeriodType.BI_MONTHLY }, // "bi_monthly" (NOT "bi-monthly"!)
            { type: types_1.PeriodType.MONTHLY, name: types_1.PeriodType.MONTHLY }, // "monthly"
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
            // Step 2: Calculate proper index range accounting for year boundaries
            // Simple arithmetic (index - 12) doesn't work! 202502 - 12 = 202490, not 202402
            const minIndex = calculateOffsetIndex(currentPeriod, -12, type);
            const maxIndex = calculateOffsetIndex(currentPeriod, 12, type);
            console.log(`[preCreateUserPeriodSummaries] Calculated index range: ${minIndex} to ${maxIndex}`);
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
                // Add to batch with merge:true to handle race conditions
                // If budget triggers create the document first, merge won't overwrite their data
                // This prevents data loss when preCreateUserPeriodSummaries and budget triggers run concurrently
                batch.set(summaryRef, summary, { merge: true });
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