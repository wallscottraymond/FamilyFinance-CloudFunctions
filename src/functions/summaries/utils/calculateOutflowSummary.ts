import {
  OutflowPeriod,
  OutflowPeriodStatus,
} from "../../../types";
import {
  OutflowEntry,
} from "../types/periodSummaries";

/**
 * Calculates outflow entries from outflow periods
 *
 * Converts outflow periods into an array of outflow entries for frontend display.
 * Frontend calculates aggregated totals on-the-fly for better performance.
 *
 * @param outflowPeriods - Array of outflow periods to convert
 * @returns Array of OutflowEntry objects
 */
export function calculateOutflowSummary(
  outflowPeriods: OutflowPeriod[]
): OutflowEntry[] {
  console.log(
    `[calculateOutflowSummary] Converting ${outflowPeriods.length} outflow periods to entries`
  );

  // Build entries array directly (one entry per period)
  // NOTE: Firestore stores merchantName (camelCase) but TypeScript type says merchant
  // We need to handle both field names for compatibility
  const entries: OutflowEntry[] = outflowPeriods.map(outflowPeriod => {
    // Handle field name mismatch: Firestore uses merchantName, type uses merchant
    const rawPeriod = outflowPeriod as unknown as Record<string, unknown>;
    const merchantValue = (rawPeriod.merchantName as string) || outflowPeriod.merchant || "Unknown";

    // DIAGNOSTIC: Log field values to verify mapping
    console.log(`[calculateOutflowSummary] DIAGNOSTIC - Period ${outflowPeriod.id}: ` +
      `merchantName=${rawPeriod.merchantName}, merchant=${outflowPeriod.merchant}, ` +
      `resolved=${merchantValue}, description=${outflowPeriod.description}`);

    return {
    // === IDENTITY ===
    outflowId: outflowPeriod.outflowId,
    outflowPeriodId: outflowPeriod.id,
    description: outflowPeriod.description || "Unknown",
    merchant: merchantValue,
    userCustomName: outflowPeriod.userCustomName || undefined,

    // === AMOUNTS ===
    totalAmountDue: outflowPeriod.totalAmountDue || 0,
    totalAmountPaid: outflowPeriod.totalAmountPaid || 0,
    totalAmountUnpaid: outflowPeriod.totalAmountUnpaid || 0,
    totalAmountWithheld: outflowPeriod.amountWithheld || 0,
    averageAmount: outflowPeriod.averageAmount || 0,

    // === STATUS ===
    isDuePeriod: outflowPeriod.isDuePeriod,
    duePeriodCount: outflowPeriod.isDuePeriod ? 1 : 0,
    dueDate: outflowPeriod.dueDate || outflowPeriod.predictedNextDate || undefined,
    status: outflowPeriod.status || OutflowPeriodStatus.PENDING,

    // === PERIOD-SPECIFIC DATES ===
    firstDueDateInPeriod: outflowPeriod.firstDueDateInPeriod || undefined,
    nextUnpaidDueDate: outflowPeriod.nextUnpaidDueDate || undefined,

    // === PROGRESS METRICS ===
    paymentProgressPercentage: outflowPeriod.paymentProgressPercentage || 0,
    fullyPaidCount: outflowPeriod.numberOfOccurrencesPaid || 0,
    unpaidCount: outflowPeriod.numberOfOccurrencesUnpaid || 0,
    itemCount: outflowPeriod.numberOfOccurrencesInPeriod || 1, // ALWAYS at least 1 if period exists

    // === GROUPING ===
    groupId: outflowPeriod.groupId || "",
  };
  });

  console.log(`[calculateOutflowSummary] Converted ${entries.length} entries`);

  return entries;
}
