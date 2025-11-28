"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOutflowsBatch = fetchOutflowsBatch;
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
/**
 * Fetches all outflow periods for a user in a specific source period
 *
 * This function queries the outflow_periods collection to retrieve all
 * outflow periods that belong to a specific user and source period.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns Array of OutflowPeriod documents
 */
async function fetchOutflowsBatch(userId, sourcePeriodId) {
    console.log(`[fetchOutflowsBatch] Fetching outflow periods for user: ${userId}, period: ${sourcePeriodId}`);
    try {
        const outflowPeriodsSnapshot = await db
            .collection("outflow_periods")
            .where("ownerId", "==", userId)
            .where("sourcePeriodId", "==", sourcePeriodId)
            .where("isActive", "==", true)
            .get();
        const outflowPeriods = outflowPeriodsSnapshot.docs.map((doc) => doc.data());
        console.log(`[fetchOutflowsBatch] Found ${outflowPeriods.length} outflow periods`);
        return outflowPeriods;
    }
    catch (error) {
        console.error(`[fetchOutflowsBatch] Error fetching outflow periods:`, error);
        throw new Error(`Failed to fetch outflow periods for user ${userId} in period ${sourcePeriodId}: ${error}`);
    }
}
//# sourceMappingURL=fetchOutflowsBatch.js.map