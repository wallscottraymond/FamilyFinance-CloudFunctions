"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateUserPeriodSummary = void 0;
const https_1 = require("firebase-functions/v2/https");
const updateUserPeriodSummary_1 = require("../orchestration/updateUserPeriodSummary");
/**
 * API: Recalculate User Period Summary
 *
 * Forces a recalculation of a user's period summary. This is useful when:
 * - Data has changed and the user wants to see updated metrics immediately
 * - Debugging or testing summary calculations
 * - Manually triggering a refresh after data imports
 *
 * Request Parameters:
 * - periodType: string - The period type (MONTHLY, WEEKLY, BI_MONTHLY)
 * - sourcePeriodId: string - The source period ID (e.g., "2025-M11")
 * - includeEntries: boolean (optional) - Whether to include detailed entries (default: false)
 *
 * Returns:
 * - success: boolean - Whether the recalculation was successful
 * - summaryId: string - The ID of the recalculated summary
 * - message: string - Success message
 *
 * Errors:
 * - unauthenticated: User is not authenticated
 * - invalid-argument: Missing or invalid parameters
 * - internal: Server error during summary recalculation
 */
exports.recalculateUserPeriodSummary = (0, https_1.onCall)(async (request) => {
    // Check authentication
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated to recalculate period summary");
    }
    const userId = request.auth.uid;
    const { periodType, sourcePeriodId, includeEntries = false } = request.data;
    // Validate required parameters
    if (!periodType || !sourcePeriodId) {
        throw new https_1.HttpsError("invalid-argument", "periodType and sourcePeriodId are required");
    }
    console.log(`[recalculateUserPeriodSummary] Request from user: ${userId}, period: ${sourcePeriodId}, type: ${periodType}`);
    try {
        // Force recalculation by calling updateUserPeriodSummary
        const summaryId = await (0, updateUserPeriodSummary_1.updateUserPeriodSummary)(userId, periodType, sourcePeriodId, includeEntries);
        console.log(`[recalculateUserPeriodSummary] Successfully recalculated summary: ${summaryId}`);
        return {
            success: true,
            summaryId,
            message: `Successfully recalculated period summary for ${sourcePeriodId}`,
        };
    }
    catch (error) {
        console.error(`[recalculateUserPeriodSummary] Error:`, error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", `Failed to recalculate user period summary: ${error instanceof Error ? error.message : String(error)}`);
    }
});
//# sourceMappingURL=recalculateUserPeriodSummary.js.map