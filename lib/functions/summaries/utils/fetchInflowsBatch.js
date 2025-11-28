"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchInflowsBatch = fetchInflowsBatch;
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
/**
 * Fetches all inflow periods for a user in a specific source period
 *
 * This function queries the inflow_periods collection to retrieve all
 * inflow periods that belong to a specific user and source period.
 *
 * @param userId - The user ID
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns Array of InflowPeriod documents
 */
async function fetchInflowsBatch(userId, sourcePeriodId) {
    console.log(`[fetchInflowsBatch] Fetching inflow periods for user: ${userId}, period: ${sourcePeriodId}`);
    try {
        const inflowPeriodsSnapshot = await db
            .collection("inflow_periods")
            .where("ownerId", "==", userId)
            .where("sourcePeriodId", "==", sourcePeriodId)
            .where("isActive", "==", true)
            .get();
        const inflowPeriods = inflowPeriodsSnapshot.docs.map((doc) => doc.data());
        console.log(`[fetchInflowsBatch] Found ${inflowPeriods.length} inflow periods`);
        return inflowPeriods;
    }
    catch (error) {
        console.error(`[fetchInflowsBatch] Error fetching inflow periods:`, error);
        throw new Error(`Failed to fetch inflow periods for user ${userId} in period ${sourcePeriodId}: ${error}`);
    }
}
//# sourceMappingURL=fetchInflowsBatch.js.map