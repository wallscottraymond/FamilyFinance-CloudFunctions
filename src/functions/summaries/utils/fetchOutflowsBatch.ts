import { getFirestore } from "firebase-admin/firestore";
import { OutflowPeriod } from "../../../types";

const db = getFirestore();

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
export async function fetchOutflowsBatch(
  userId: string,
  sourcePeriodId: string
): Promise<OutflowPeriod[]> {
  console.log(
    `[fetchOutflowsBatch] Fetching outflow periods for user: ${userId}, period: ${sourcePeriodId}`
  );

  try {
    // ===== DIAGNOSTIC: Log query parameters =====
    console.log(`[fetchOutflowsBatch] DIAGNOSTIC - Query: ownerId=${userId}, sourcePeriodId=${sourcePeriodId}, isActive=true`);

    const outflowPeriodsSnapshot = await db
      .collection("outflow_periods")
      .where("ownerId", "==", userId)
      .where("sourcePeriodId", "==", sourcePeriodId)
      .where("isActive", "==", true)
      .get();

    const outflowPeriods = outflowPeriodsSnapshot.docs.map(
      (doc) => doc.data() as OutflowPeriod
    );

    console.log(
      `[fetchOutflowsBatch] Found ${outflowPeriods.length} outflow periods`
    );

    // ===== DIAGNOSTIC: Log sample data if found =====
    if (outflowPeriods.length > 0) {
      const sample = outflowPeriods[0];
      console.log(`[fetchOutflowsBatch] DIAGNOSTIC - Sample period: id=${sample.id}, ownerId=${sample.ownerId}, description=${sample.description}`);
    } else {
      console.log(`[fetchOutflowsBatch] DIAGNOSTIC - No outflow periods found. Check if periods exist with these query params.`);
    }

    return outflowPeriods;
  } catch (error) {
    console.error(`[fetchOutflowsBatch] Error fetching outflow periods:`, error);
    throw new Error(
      `Failed to fetch outflow periods for user ${userId} in period ${sourcePeriodId}: ${error}`
    );
  }
}
