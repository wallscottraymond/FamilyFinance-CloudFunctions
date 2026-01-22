import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { UserPeriodSummary } from "../types/periodSummaries";
import { updateUserPeriodSummary } from "../orchestration/updateUserPeriodSummary";

const db = getFirestore();

/**
 * API: Get User Period Summary
 *
 * Fetches a user's period summary for a specific period. If the summary
 * doesn't exist, it generates it on-demand.
 *
 * Request Parameters:
 * - periodType: string - The period type (MONTHLY, WEEKLY, BI_MONTHLY)
 * - sourcePeriodId: string - The source period ID (e.g., "2025-M11")
 * - includeEntries: boolean (optional) - Whether to include detailed entries (default: false)
 *
 * Returns:
 * - UserPeriodSummary object
 *
 * Errors:
 * - unauthenticated: User is not authenticated
 * - invalid-argument: Missing or invalid parameters
 * - internal: Server error during summary generation
 */
export const getUserPeriodSummary = onCall(async (request) => {
  // Check authentication
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "User must be authenticated to get period summary"
    );
  }

  const userId = request.auth.uid;
  const { periodType, sourcePeriodId, includeEntries = false } = request.data;

  // Validate required parameters
  if (!periodType || !sourcePeriodId) {
    throw new HttpsError(
      "invalid-argument",
      "periodType and sourcePeriodId are required"
    );
  }

  console.log(
    `[getUserPeriodSummary] Request from user: ${userId}, period: ${sourcePeriodId}, type: ${periodType}`
  );

  try {
    // Build summary ID
    const summaryId = `${userId}_${periodType}_${sourcePeriodId}`;

    // Check if summary exists
    const summaryRef = db.collection("user_summaries").doc(summaryId);
    const summaryDoc = await summaryRef.get();

    if (summaryDoc.exists) {
      // Summary exists, return it
      console.log(
        `[getUserPeriodSummary] Returning existing summary: ${summaryId}`
      );

      const summary = summaryDoc.data() as UserPeriodSummary;

      // If detailed entries are requested but not in the cached summary,
      // regenerate with entries
      if (includeEntries && !summary.outflows.entries) {
        console.log(
          `[getUserPeriodSummary] Regenerating summary with entries: ${summaryId}`
        );

        await updateUserPeriodSummary(
          userId,
          periodType,
          sourcePeriodId,
          includeEntries
        );

        // Fetch the updated summary
        const updatedSummaryDoc = await summaryRef.get();
        return updatedSummaryDoc.data() as UserPeriodSummary;
      }

      return summary;
    } else {
      // Summary doesn't exist, generate it on-demand
      console.log(
        `[getUserPeriodSummary] Generating new summary on-demand: ${summaryId}`
      );

      await updateUserPeriodSummary(
        userId,
        periodType,
        sourcePeriodId,
        includeEntries
      );

      // Fetch the newly created summary
      const newSummaryDoc = await summaryRef.get();

      if (!newSummaryDoc.exists) {
        throw new HttpsError(
          "internal",
          "Failed to create summary - summary document not found after creation"
        );
      }

      console.log(
        `[getUserPeriodSummary] Successfully created and returning new summary: ${summaryId}`
      );

      return newSummaryDoc.data() as UserPeriodSummary;
    }
  } catch (error) {
    console.error(`[getUserPeriodSummary] Error:`, error);

    if (error instanceof HttpsError) {
      throw error;
    }

    throw new HttpsError(
      "internal",
      `Failed to get user period summary: ${error instanceof Error ? error.message : String(error)}`
    );
  }
});
