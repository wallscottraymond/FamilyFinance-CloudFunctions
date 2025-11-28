import { getFirestore } from "firebase-admin/firestore";
import { SourcePeriod } from "../../../types";

const db = getFirestore();

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
export async function fetchSourcePeriod(
  sourcePeriodId: string
): Promise<SourcePeriod> {
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

  const sourcePeriod = sourcePeriodDoc.data() as SourcePeriod;

  console.log(`[fetchSourcePeriod] Found source period:`, {
    periodId: sourcePeriod.periodId,
    type: sourcePeriod.type,
    year: sourcePeriod.year,
    month: sourcePeriod.metadata.month,
    weekNumber: sourcePeriod.metadata.weekNumber,
  });

  return sourcePeriod;
}
