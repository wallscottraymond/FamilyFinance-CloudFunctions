import { getFirestore } from "firebase-admin/firestore";
import { updateUserPeriodSummary } from "./updateUserPeriodSummary";
import { SourcePeriod, PeriodType } from "../../../types";

const db = getFirestore();

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
export async function preCreateUserPeriodSummaries(
  userId: string
): Promise<void> {
  console.log(
    `[preCreateUserPeriodSummaries] Pre-creating summaries for user: ${userId}`
  );

  const startTime = Date.now();

  try {
    // Process all three period types
    const periodTypes = [
      { type: PeriodType.WEEKLY, name: "weekly" },
      { type: PeriodType.BI_MONTHLY, name: "bi-monthly" },
      { type: PeriodType.MONTHLY, name: "monthly" },
    ];

    const allSummaryPromises: Promise<string>[] = [];
    const summaryStats: Record<string, { total: number; success: number; errors: number }> = {};

    for (const { type, name } of periodTypes) {
      console.log(
        `[preCreateUserPeriodSummaries] Processing ${name} periods for user: ${userId}`
      );

      // Step 1: Find the current period for this type
      const currentPeriodQuery = await db
        .collection("source_periods")
        .where("type", "==", type)
        .where("isCurrent", "==", true)
        .limit(1)
        .get();

      if (currentPeriodQuery.empty) {
        console.warn(
          `[preCreateUserPeriodSummaries] No current ${name} period found in source_periods`
        );
        summaryStats[name] = { total: 0, success: 0, errors: 0 };
        continue;
      }

      const currentPeriodDoc = currentPeriodQuery.docs[0];
      const currentPeriod = currentPeriodDoc.data() as SourcePeriod;
      const currentIndex = currentPeriod.index;

      console.log(
        `[preCreateUserPeriodSummaries] Found current ${name} period: ${currentPeriodDoc.id} (index: ${currentIndex})`
      );

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

      console.log(
        `[preCreateUserPeriodSummaries] Found ${periodsQuery.size} ${name} periods in range ${minIndex}-${maxIndex}`
      );

      summaryStats[name] = { total: periodsQuery.size, success: 0, errors: 0 };

      // Step 3: Create summaries for each period using actual document IDs
      for (const periodDoc of periodsQuery.docs) {
        const sourcePeriodId = periodDoc.id; // Use document ID (e.g., "2025M02")

        // Create summary (without detailed entries for initial creation)
        const summaryPromise = updateUserPeriodSummary(
          userId,
          name, // Period type as string
          sourcePeriodId, // Use document ID (no hyphen)
          false // Don't include detailed entries
        )
          .then((summaryId) => {
            summaryStats[name].success++;
            return summaryId;
          })
          .catch((error) => {
            // Log error but don't fail the entire operation
            console.error(
              `[preCreateUserPeriodSummaries] Error creating ${name} summary for ${sourcePeriodId}:`,
              error
            );
            summaryStats[name].errors++;
            return `error-${sourcePeriodId}`;
          });

        allSummaryPromises.push(summaryPromise);
      }
    }

    // Wait for all summaries to be created
    await Promise.all(allSummaryPromises);

    const duration = Date.now() - startTime;

    const totalSummaries = Object.values(summaryStats).reduce((sum, stat) => sum + stat.total, 0);
    const totalSuccess = Object.values(summaryStats).reduce((sum, stat) => sum + stat.success, 0);
    const totalErrors = Object.values(summaryStats).reduce((sum, stat) => sum + stat.errors, 0);

    console.log(
      `[preCreateUserPeriodSummaries] Completed in ${duration}ms for user: ${userId}`,
      {
        totalSummaries,
        successful: totalSuccess,
        errors: totalErrors,
        breakdown: summaryStats,
      }
    );

    if (totalErrors > 0) {
      console.warn(
        `[preCreateUserPeriodSummaries] ${totalErrors} summaries failed to create, but operation completed`
      );
    }
  } catch (error) {
    console.error(
      `[preCreateUserPeriodSummaries] Fatal error pre-creating summaries for user ${userId}:`,
      error
    );
    // Don't throw - we don't want to fail user account creation if summary pre-creation fails
  }
}
