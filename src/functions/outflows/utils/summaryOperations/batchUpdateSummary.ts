import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { PeriodType, OutflowPeriodEntry, OutflowPeriodSummary } from "../../../../types";
import { recalculatePeriodGroup } from "./recalculatePeriodGroup";
import { updatePeriodNames } from "./updatePeriodNames";
import { buildSummaryId } from "./recalculateFullSummary";

/**
 * Operation types supported by batch update
 */
export type SummaryOperation =
  | { type: 'recalculate'; data: RecalculateOperationData }
  | { type: 'updateNames'; data: UpdateNamesOperationData };

interface RecalculateOperationData {
  sourcePeriodId: string;
  ownerId: string;
  ownerType: 'user' | 'group';
  periodType: PeriodType;
}

interface UpdateNamesOperationData {
  outflowId: string;
  merchant: string;
  userCustomName: string;
}

/**
 * Batch Update Summary - Core Orchestration Function
 *
 * Coordinates multiple update operations into a single atomic Firestore write.
 * This ensures all changes succeed or fail together, maintaining data consistency.
 *
 * Supported Operations:
 * - 'recalculate': Recalculate a specific sourcePeriodId group
 * - 'updateNames': Update merchant/userCustomName for an outflow
 *
 * Process:
 * 1. Fetch current summary document (or create if missing)
 * 2. Execute all operations sequentially on in-memory copy
 * 3. Collect all changes
 * 4. Single Firestore batch write with all updates
 * 5. Update metadata (lastRecalculated, updatedAt, totalItemCount)
 *
 * @param params - Batch update parameters
 */
export async function batchUpdateSummary(params: {
  summaryId: string;
  operations: SummaryOperation[];
}): Promise<void> {
  const { summaryId, operations } = params;
  const db = admin.firestore();

  console.log(`🔄 Starting batch update for summary: ${summaryId}`, {
    operationCount: operations.length,
    operationTypes: operations.map(op => op.type)
  });

  try {
    // Fetch current summary or prepare new one
    const summaryRef = db.collection('outflow_summary').doc(summaryId);
    const summaryDoc = await summaryRef.get();

    let currentPeriods: { [sourcePeriodId: string]: OutflowPeriodEntry[] } = {};
    let ownerId: string = '';
    let ownerType: 'user' | 'group' = 'user';
    let periodType: PeriodType = PeriodType.MONTHLY;

    if (summaryDoc.exists) {
      const summaryData = summaryDoc.data() as OutflowPeriodSummary;
      currentPeriods = summaryData.periods || {};
      ownerId = summaryData.ownerId;
      ownerType = summaryData.ownerType;
      periodType = summaryData.periodType;

      console.log(`📖 Loaded existing summary with ${Object.keys(currentPeriods).length} period groups`);
    } else {
      console.log(`📝 Summary does not exist, will create new one`);
      // Extract owner info from first recalculate operation
      const firstRecalc = operations.find(op => op.type === 'recalculate');
      if (firstRecalc && firstRecalc.type === 'recalculate') {
        ownerId = firstRecalc.data.ownerId;
        ownerType = firstRecalc.data.ownerType;
        periodType = firstRecalc.data.periodType;
      }
    }

    // Step 2: Execute all operations sequentially on in-memory copy
    let updatedPeriods = { ...currentPeriods };

    for (const operation of operations) {
      try {
        if (operation.type === 'recalculate') {
          const { sourcePeriodId, ownerId, ownerType, periodType } = operation.data;

          console.log(`🔄 Executing recalculate for period: ${sourcePeriodId}`);

          const entries = await recalculatePeriodGroup({
            ownerId,
            ownerType,
            periodType,
            sourcePeriodId
          });

          if (entries.length > 0) {
            updatedPeriods[sourcePeriodId] = entries;
          } else {
            // No entries means this period group should be removed
            delete updatedPeriods[sourcePeriodId];
          }

        } else if (operation.type === 'updateNames') {
          const { outflowId, merchant, userCustomName } = operation.data;

          console.log(`🔄 Executing updateNames for outflow: ${outflowId}`);

          updatedPeriods = updatePeriodNames({
            currentPeriods: updatedPeriods,
            outflowId,
            merchant,
            userCustomName
          });
        }

      } catch (error) {
        console.error(`❌ Error executing operation ${operation.type}:`, error);
        throw error; // Fail entire batch if any operation fails
      }
    }

    // Step 3: Calculate total item count
    const totalItemCount = Object.values(updatedPeriods).reduce(
      (sum, entries) => sum + entries.length,
      0
    );

    // Step 4: Prepare summary document
    const now = Timestamp.now();
    const windowStart = Timestamp.fromDate(new Date(new Date().getFullYear() - 1, 0, 1));
    const windowEnd = Timestamp.fromDate(new Date(new Date().getFullYear() + 1, 11, 31));

    const summaryData: Partial<OutflowPeriodSummary> = {
      periods: updatedPeriods,
      totalItemCount,
      lastRecalculated: now,
      updatedAt: now
    };

    // Add creation fields if new document
    if (!summaryDoc.exists) {
      Object.assign(summaryData, {
        ownerId,
        ownerType,
        periodType,
        resourceType: 'outflow' as const,
        windowStart,
        windowEnd,
        createdAt: now
      });
    }

    // Step 5: Write to Firestore
    await summaryRef.set(summaryData, { merge: true });

    console.log(`✅ Batch update complete for ${summaryId}:`, {
      periodGroups: Object.keys(updatedPeriods).length,
      totalItems: totalItemCount,
      operationsExecuted: operations.length
    });

  } catch (error) {
    console.error(`❌ Batch update failed for ${summaryId}:`, error);
    throw error;
  }
}

/**
 * Helper function to get or create summary ID
 */
export function getSummaryId(
  ownerId: string,
  ownerType: 'user' | 'group',
  periodType: PeriodType
): string {
  return buildSummaryId(ownerId, ownerType, periodType);
}
