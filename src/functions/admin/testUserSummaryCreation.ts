import { onCall, HttpsError } from "firebase-functions/v2/https";
import { updateUserPeriodSummary } from "../summaries/orchestration/updateUserPeriodSummary";

/**
 * DEV/ADMIN: Test User Summary Creation
 *
 * Manually trigger user_summaries document creation for a specific period
 * to debug why the trigger isn't working.
 *
 * Usage:
 * firebase functions:call testUserSummaryCreation --data '{
 *   "userId": "6GQtnUstiVQkBwfdoKojCOY3DVzC",
 *   "periodType": "bi_monthly",
 *   "sourcePeriodId": "2026BM06B"
 * }'
 */
export const testUserSummaryCreation = onCall(async (request) => {
  console.log("[testUserSummaryCreation] Starting manual summary creation test");
  console.log("Request data:", request.data);

  const { userId, periodType, sourcePeriodId } = request.data;

  if (!userId || !periodType || !sourcePeriodId) {
    throw new HttpsError(
      "invalid-argument",
      "Missing required fields: userId, periodType, sourcePeriodId"
    );
  }

  try {
    console.log(`[testUserSummaryCreation] Creating summary for:`, {
      userId,
      periodType,
      sourcePeriodId,
    });

    const summaryId = await updateUserPeriodSummary(
      userId,
      periodType,
      sourcePeriodId,
      true // Include entries for debugging
    );

    console.log(`[testUserSummaryCreation] Successfully created summary: ${summaryId}`);

    return {
      success: true,
      summaryId,
      message: "User summary created successfully",
    };
  } catch (error) {
    console.error("[testUserSummaryCreation] Error creating summary:", error);
    throw new HttpsError(
      "internal",
      `Failed to create summary: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});
