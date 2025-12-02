import * as admin from "firebase-admin";
import {
  OutflowPeriodEntry,
  OutflowStatusCounts,
  OutflowPeriod,
  Outflow,
  PeriodType,
  OutflowPeriodStatus
} from "../../../../types";

/**
 * Recalculate all outflow period entries for a specific sourcePeriodId
 *
 * This function:
 * 1. Queries all outflow_periods with the given sourcePeriodId
 * 2. Creates ONE OutflowPeriodEntry for EACH outflow_period
 * 3. Fetches parent outflow data for merchant/userCustomName
 * 4. Returns array of OutflowPeriodEntry objects ready for batch write
 *
 * NOTE: No aggregation! Each outflow_period maps to exactly one entry.
 *
 * @param params - Calculation parameters
 * @returns Array of OutflowPeriodEntry objects for the period group
 */
export async function recalculatePeriodGroup(params: {
  ownerId: string;
  ownerType: 'user' | 'group';
  periodType: PeriodType;
  sourcePeriodId: string;
}): Promise<OutflowPeriodEntry[]> {
  const { ownerId, ownerType, periodType, sourcePeriodId } = params;
  const db = admin.firestore();

  console.log(`🔄 Recalculating outflow period group:`, {
    ownerId,
    ownerType,
    periodType,
    sourcePeriodId
  });

  try {
    // Step 1: Query all outflow_periods for this sourcePeriodId
    const periodsQuery = await db.collection('outflow_periods')
      .where('ownerId', '==', ownerId)
      .where('sourcePeriodId', '==', sourcePeriodId)
      .where('periodType', '==', periodType)
      .where('isActive', '==', true)
      .get();

    if (periodsQuery.empty) {
      console.log(`✅ No active outflow periods found for ${sourcePeriodId}`);
      return [];
    }

    console.log(`📊 Found ${periodsQuery.size} outflow periods for ${sourcePeriodId}`);

    // Step 2: Create ONE entry per outflow_period (NO grouping!)
    const entries: OutflowPeriodEntry[] = [];

    for (const periodDoc of periodsQuery.docs) {
      try {
        const period = { id: periodDoc.id, ...periodDoc.data() } as OutflowPeriod;

        // Fetch parent outflow for merchant/userCustomName
        const outflowDoc = await db.collection('outflows').doc(period.outflowId).get();

        if (!outflowDoc.exists) {
          console.warn(`⚠️ Outflow ${period.outflowId} not found, skipping period ${period.id}`);
          continue;
        }

        const outflow = outflowDoc.data() as Outflow;

        // Build entry directly from this ONE period
        const entry = buildPeriodEntry(period, outflow);
        entries.push(entry);

        console.log(`✅ Created entry for period: ${outflow.merchantName || outflow.description}`);

      } catch (error) {
        console.error(`❌ Error processing period ${periodDoc.id}:`, error);
        // Continue with other periods even if one fails
      }
    }

    console.log(`✅ Successfully calculated ${entries.length} outflow period entries`);
    return entries;

  } catch (error) {
    console.error(`❌ Error recalculating period group for ${sourcePeriodId}:`, error);
    throw error;
  }
}

/**
 * Build OutflowPeriodEntry from a SINGLE outflow period
 * No aggregation - each period is its own entry
 *
 * @param period - Single outflow period document
 * @param outflow - Parent outflow document
 * @returns OutflowPeriodEntry for this single period
 */
function buildPeriodEntry(
  period: OutflowPeriod,
  outflow: Outflow
): OutflowPeriodEntry {
  // Calculate payment progress percentage
  const paymentProgressPercentage = period.totalAmountDue > 0
    ? Math.round((period.totalAmountPaid / period.totalAmountDue) * 100)
    : 0;

  // Determine status counts from period status
  const statusCounts: OutflowStatusCounts = {};
  const status = period.status || OutflowPeriodStatus.PENDING;
  const statusKey = status.toUpperCase().replace('_', '_') as keyof OutflowStatusCounts;
  statusCounts[statusKey] = 1; // This entry represents ONE period

  return {
    // Period Identity
    periodId: period.id,
    outflowId: outflow.id,
    groupId: period.groupId || '',
    merchant: outflow.merchantName || outflow.description || 'Unknown',
    userCustomName: outflow.userCustomName || outflow.merchantName || outflow.description || 'Unknown',

    // Amount Totals (directly from the ONE period)
    totalAmountDue: period.totalAmountDue || 0,
    totalAmountPaid: period.totalAmountPaid || 0,
    totalAmountUnpaid: period.totalAmountUnpaid || 0,
    totalAmountWithheld: period.amountWithheld || 0,
    averageAmount: period.averageAmount || 0,

    // Due Status
    isDuePeriod: period.isDuePeriod || false,
    duePeriodCount: period.isDuePeriod ? 1 : 0,

    // Status Breakdown
    statusCounts,

    // Progress Metrics
    paymentProgressPercentage,
    fullyPaidCount: period.isFullyPaid ? 1 : 0,
    unpaidCount: (!period.isFullyPaid && !period.isPartiallyPaid) ? 1 : 0,
    itemCount: 1  // This entry represents exactly ONE period
  };
}
