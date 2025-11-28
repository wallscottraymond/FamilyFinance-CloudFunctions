import {
  OutflowPeriod,
  OutflowPeriodStatus,
} from "../../../types";
import {
  OutflowSummaryData,
  OutflowEntry,
} from "../../../types/periodSummaries";

/**
 * Calculates outflow summary data from outflow periods
 *
 * Aggregates all outflow periods for a given period into a summary object
 * containing totals, counts, status breakdowns, and optional detailed entries.
 *
 * @param outflowPeriods - Array of outflow periods to aggregate
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns OutflowSummaryData object
 */
export function calculateOutflowSummary(
  outflowPeriods: OutflowPeriod[],
  includeEntries: boolean = true // ALWAYS include entries for tile rendering
): OutflowSummaryData {
  console.log(
    `[calculateOutflowSummary] Calculating summary for ${outflowPeriods.length} outflow periods`
  );

  // Initialize totals
  let totalAmountDue = 0;
  let totalAmountPaid = 0;
  let totalAmountWithheld = 0;

  // Initialize counts
  let totalCount = 0;
  let duePeriodCount = 0;
  let fullyPaidCount = 0;
  let unpaidCount = 0;

  // Initialize status counts
  const statusCounts: {
    PAID?: number;
    OVERDUE?: number;
    DUE_SOON?: number;
    PENDING?: number;
    PARTIAL?: number;
    NOT_DUE?: number;
  } = {};

  // Initialize entries array if requested
  const entries: OutflowEntry[] = [];

  // Process each outflow period
  for (const outflowPeriod of outflowPeriods) {
    // Accumulate totals
    totalAmountDue += outflowPeriod.totalAmountDue || 0;
    totalAmountPaid += outflowPeriod.totalAmountPaid || 0;
    totalAmountWithheld += outflowPeriod.amountWithheld || 0;

    // Increment counts
    totalCount++;

    if (outflowPeriod.isDuePeriod) {
      duePeriodCount++;
    }

    if (outflowPeriod.isFullyPaid) {
      fullyPaidCount++;
    }

    if (outflowPeriod.totalAmountUnpaid > 0) {
      unpaidCount++;
    }

    // Count status
    const status = outflowPeriod.status;
    if (status) {
      // Normalize status to match summary format
      let summaryStatus: keyof typeof statusCounts;

      switch (status) {
        case OutflowPeriodStatus.PAID:
        case OutflowPeriodStatus.PAID_EARLY:
          summaryStatus = "PAID";
          break;
        case OutflowPeriodStatus.OVERDUE:
          summaryStatus = "OVERDUE";
          break;
        case OutflowPeriodStatus.DUE_SOON:
          summaryStatus = "DUE_SOON";
          break;
        case OutflowPeriodStatus.PENDING:
          summaryStatus = "PENDING";
          break;
        case OutflowPeriodStatus.PARTIAL:
          summaryStatus = "PARTIAL";
          break;
        default:
          summaryStatus = "NOT_DUE";
      }

      statusCounts[summaryStatus] = (statusCounts[summaryStatus] || 0) + 1;
    }

    // Build detailed entry if requested (now always true)
    if (includeEntries) {
      const entry: OutflowEntry = {
        // === IDENTITY ===
        outflowId: outflowPeriod.outflowId,
        outflowPeriodId: outflowPeriod.id,
        description: outflowPeriod.description || "Unknown",
        merchant: outflowPeriod.merchant || "Unknown",
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

        // === PROGRESS METRICS ===
        paymentProgressPercentage: outflowPeriod.paymentProgressPercentage || 0,
        fullyPaidCount: outflowPeriod.numberOfOccurrencesPaid || 0,
        unpaidCount: outflowPeriod.numberOfOccurrencesUnpaid || 0,
        itemCount: outflowPeriod.numberOfOccurrencesInPeriod || 1,

        // === GROUPING ===
        groupId: outflowPeriod.groupId || "",
      };
      entries.push(entry);
    }
  }

  const summary: OutflowSummaryData = {
    totalAmountDue,
    totalAmountPaid,
    totalAmountWithheld,
    totalCount,
    duePeriodCount,
    fullyPaidCount,
    unpaidCount,
    statusCounts,
  };

  // Add entries if requested
  if (includeEntries) {
    summary.entries = entries;
  }

  console.log(`[calculateOutflowSummary] Summary calculated:`, {
    totalAmountDue,
    totalAmountPaid,
    totalAmountWithheld,
    totalCount,
    duePeriodCount,
    fullyPaidCount,
    unpaidCount,
    statusCounts,
    entriesCount: entries.length,
  });

  return summary;
}
