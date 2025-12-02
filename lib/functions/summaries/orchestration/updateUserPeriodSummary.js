"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserPeriodSummary = updateUserPeriodSummary;
const firestore_1 = require("firebase-admin/firestore");
const calculateUserPeriodSummary_1 = require("../utils/calculateUserPeriodSummary");
const db = (0, firestore_1.getFirestore)();
/**
 * Updates or creates a user period summary in Firestore
 *
 * This orchestration function:
 * 1. Calculates the complete user period summary
 * 2. Checks if a summary already exists
 * 3. Creates a new summary or updates the existing one
 * 4. Returns the summary document
 *
 * This function is called by:
 * - Firestore triggers when resource periods change
 * - API endpoints for manual recalculation
 * - On-demand when a user requests a period summary that doesn't exist
 *
 * @param userId - The user ID
 * @param periodType - The period type (MONTHLY, WEEKLY, BI_MONTHLY)
 * @param sourcePeriodId - The source period ID (e.g., "2025-M11")
 * @param includeEntries - Whether to include detailed entries (default: true - always include for tile rendering)
 * @returns The summary document ID
 */
async function updateUserPeriodSummary(userId, periodType, sourcePeriodId, includeEntries = true // ALWAYS include entries for tile rendering
) {
    console.log(`[updateUserPeriodSummary] Starting update for user: ${userId}, period: ${sourcePeriodId}, type: ${periodType}`);
    const startTime = Date.now();
    try {
        // Step 1: Calculate the complete summary
        const summary = await (0, calculateUserPeriodSummary_1.calculateUserPeriodSummary)(userId, periodType, sourcePeriodId, includeEntries);
        // Step 2: Build document ID
        const summaryId = summary.id;
        // Step 3: Check if summary already exists
        const summaryRef = db.collection("user_summaries").doc(summaryId);
        const existingSummary = await summaryRef.get();
        if (existingSummary.exists) {
            // Update existing summary
            console.log(`[updateUserPeriodSummary] Updating existing summary: ${summaryId}`);
            await summaryRef.update({
                // Update all resource entry arrays
                outflows: summary.outflows,
                budgets: summary.budgets,
                inflows: summary.inflows,
                goals: summary.goals,
                // Update metadata
                lastRecalculated: firestore_1.Timestamp.now(),
                updatedAt: firestore_1.Timestamp.now(),
            });
            console.log(`[updateUserPeriodSummary] Successfully updated summary: ${summaryId}`);
        }
        else {
            // Create new summary
            console.log(`[updateUserPeriodSummary] Creating new summary: ${summaryId}`);
            await summaryRef.set(summary);
            console.log(`[updateUserPeriodSummary] Successfully created summary: ${summaryId}`);
        }
        const duration = Date.now() - startTime;
        console.log(`[updateUserPeriodSummary] Completed in ${duration}ms for summary: ${summaryId}`, {
            action: existingSummary.exists ? "updated" : "created",
            resourceCounts: {
                outflows: summary.outflows.length,
                budgets: summary.budgets.length,
                inflows: summary.inflows.length,
                goals: summary.goals.length
            }
        });
        return summaryId;
    }
    catch (error) {
        console.error(`[updateUserPeriodSummary] Error updating summary for user ${userId}, period ${sourcePeriodId}:`, error);
        throw new Error(`Failed to update user period summary: ${error instanceof Error ? error.message : String(error)}`);
    }
}
//# sourceMappingURL=updateUserPeriodSummary.js.map