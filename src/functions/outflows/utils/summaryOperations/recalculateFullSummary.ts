import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { PeriodType, OutflowPeriodEntry } from "../../../../types";
import { recalculatePeriodGroup } from "./recalculatePeriodGroup";

/**
 * Recalculate the entire outflow summary from scratch
 *
 * This function is used for:
 * - Initial summary creation
 * - Full data backfill/migration
 * - Debugging and verification
 * - Recovery from data inconsistencies
 *
 * Process:
 * 1. Query all active outflow_periods in 2-year window
 * 2. Extract unique sourcePeriodIds
 * 3. Call recalculatePeriodGroup() for each sourcePeriodId
 * 4. Build complete periods object grouped by sourcePeriodId
 *
 * @param params - Calculation parameters
 * @returns Complete periods object ready for summary document
 */
export async function recalculateFullSummary(params: {
  ownerId: string;
  ownerType: 'user' | 'group';
  periodType: PeriodType;
}): Promise<{
  periods: { [sourcePeriodId: string]: OutflowPeriodEntry[] };
  totalItemCount: number;
}> {
  const { ownerId, ownerType, periodType } = params;
  const db = admin.firestore();

  console.log(`🔄 Recalculating FULL outflow summary:`, {
    ownerId,
    ownerType,
    periodType
  });

  try {
    // Step 1: Define 2-year window (1 year past, 1 year future)
    const now = new Date();
    const windowStart = new Date(now.getFullYear() - 1, 0, 1); // Jan 1 of last year
    const windowEnd = new Date(now.getFullYear() + 1, 11, 31); // Dec 31 of next year

    console.log(`📅 Window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

    // Step 2: Query all active outflow_periods in window
    const periodsQuery = await db.collection('outflow_periods')
      .where('ownerId', '==', ownerId)
      .where('periodType', '==', periodType)
      .where('isActive', '==', true)
      .where('cycleStartDate', '>=', Timestamp.fromDate(windowStart))
      .where('cycleStartDate', '<=', Timestamp.fromDate(windowEnd))
      .get();

    if (periodsQuery.empty) {
      console.log(`✅ No active outflow periods found in window`);
      return {
        periods: {},
        totalItemCount: 0
      };
    }

    console.log(`📊 Found ${periodsQuery.size} total outflow periods in window`);

    // Step 3: Extract unique sourcePeriodIds
    const sourcePeriodIds = new Set<string>();
    periodsQuery.forEach(doc => {
      const sourcePeriodId = doc.data().sourcePeriodId;
      if (sourcePeriodId) {
        sourcePeriodIds.add(sourcePeriodId);
      }
    });

    console.log(`📦 Found ${sourcePeriodIds.size} unique source periods`);

    // Step 4: Recalculate each period group
    const periods: { [sourcePeriodId: string]: OutflowPeriodEntry[] } = {};
    let totalItemCount = 0;

    for (const sourcePeriodId of Array.from(sourcePeriodIds)) {
      try {
        console.log(`🔄 Recalculating period group: ${sourcePeriodId}`);

        const entries = await recalculatePeriodGroup({
          ownerId,
          ownerType,
          periodType,
          sourcePeriodId
        });

        if (entries.length > 0) {
          periods[sourcePeriodId] = entries;
          totalItemCount += entries.length;
        }

        console.log(`✅ Period ${sourcePeriodId}: ${entries.length} entries`);

      } catch (error) {
        console.error(`❌ Error recalculating period ${sourcePeriodId}:`, error);
        // Continue with other periods even if one fails
      }
    }

    console.log(`✅ Full summary recalculation complete:`, {
      uniquePeriods: Object.keys(periods).length,
      totalItemCount
    });

    return {
      periods,
      totalItemCount
    };

  } catch (error) {
    console.error(`❌ Error recalculating full summary:`, error);
    throw error;
  }
}

/**
 * Helper function to format summary ID
 */
export function buildSummaryId(
  ownerId: string,
  ownerType: 'user' | 'group',
  periodType: PeriodType
): string {
  const typeStr = periodType.toLowerCase();
  return `${ownerId}_outflowsummary_${typeStr}`;
}
