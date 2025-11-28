"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchSourcePeriod = fetchSourcePeriod;
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
/**
 * Fetches a source period document by its period ID
 *
 * Source periods are the single source of truth for period definitions.
 * Examples: "2025-M11", "2025-W45", "2025-BM11-A"
 *
 * @param sourcePeriodId - The period ID (e.g., "2025-M11")
 * @returns The SourcePeriod document
 * @throws Error if the source period is not found
 */
async function fetchSourcePeriod(sourcePeriodId) {
    console.log(`[fetchSourcePeriod] Fetching source period: ${sourcePeriodId}`);
    const sourcePeriodDoc = await db
        .collection("source_periods")
        .doc(sourcePeriodId)
        .get();
    if (!sourcePeriodDoc.exists) {
        const errorMsg = `Source period not found: ${sourcePeriodId}`;
        console.error(`[fetchSourcePeriod] ${errorMsg}`);
        throw new Error(errorMsg);
    }
    const sourcePeriod = sourcePeriodDoc.data();
    console.log(`[fetchSourcePeriod] Found source period:`, {
        periodId: sourcePeriod.periodId,
        type: sourcePeriod.type,
        year: sourcePeriod.year,
        month: sourcePeriod.metadata.month,
        weekNumber: sourcePeriod.metadata.weekNumber,
    });
    return sourcePeriod;
}
//# sourceMappingURL=fetchSourcePeriod.js.map