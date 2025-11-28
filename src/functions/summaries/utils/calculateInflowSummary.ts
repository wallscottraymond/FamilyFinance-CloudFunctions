import { InflowPeriod } from "../../../types";
import {
  InflowSummaryData,
  InflowEntry,
} from "../../../types/periodSummaries";

/**
 * Calculates inflow summary data from inflow periods
 *
 * Aggregates all inflow periods for a given period into a summary object
 * containing totals, counts, and optional detailed entries.
 *
 * @param inflowPeriods - Array of inflow periods to aggregate
 * @param includeEntries - Whether to include detailed entries (default: false)
 * @returns InflowSummaryData object
 */
export function calculateInflowSummary(
  inflowPeriods: InflowPeriod[],
  includeEntries: boolean = true // ALWAYS include entries for tile rendering
): InflowSummaryData {
  console.log(
    `[calculateInflowSummary] Calculating summary for ${inflowPeriods.length} inflow periods`
  );

  // Initialize totals
  let totalExpectedIncome = 0;
  let totalReceivedIncome = 0;
  let totalPendingIncome = 0;

  // Initialize counts
  let totalCount = 0;
  let receiptPeriodCount = 0;
  let fullyReceivedCount = 0;
  let pendingCount = 0;

  // Initialize entries array if requested
  const entries: InflowEntry[] = [];

  // Process each inflow period
  for (const inflowPeriod of inflowPeriods) {
    // Calculate amounts
    const expectedAmount = inflowPeriod.totalAmountDue || 0;
    const receivedAmount = inflowPeriod.totalAmountPaid || 0;
    const pendingAmount = expectedAmount - receivedAmount;

    // Accumulate totals
    totalExpectedIncome += expectedAmount;
    totalReceivedIncome += receivedAmount;
    totalPendingIncome += pendingAmount;

    // Increment counts
    totalCount++;

    if (inflowPeriod.isReceiptPeriod) {
      receiptPeriodCount++;
    }

    if (inflowPeriod.isFullyPaid) {
      fullyReceivedCount++;
    }

    if (pendingAmount > 0) {
      pendingCount++;
    }

    // Build detailed entry if requested (now always true)
    if (includeEntries) {
      // Determine if this is regular salary based on Plaid category
      const plaidCategory = inflowPeriod.plaidDetailedCategory?.toUpperCase() || "";
      const isRegularSalary =
        plaidCategory.includes("WAGES") || plaidCategory.includes("SALARY");

      // Determine income type based on Plaid category
      let incomeType = "other";
      if (plaidCategory.includes("WAGES") || plaidCategory.includes("SALARY")) {
        incomeType = "salary";
      } else if (plaidCategory.includes("FREELANCE") || plaidCategory.includes("CONTRACT")) {
        incomeType = "freelance";
      } else if (plaidCategory.includes("INVESTMENT") || plaidCategory.includes("DIVIDEND")) {
        incomeType = "investment";
      }

      // Calculate receipt progress percentage
      const receiptProgressPercentage =
        expectedAmount > 0
          ? Math.round((receivedAmount / expectedAmount) * 100)
          : 0;

      const entry: InflowEntry = {
        // === IDENTITY ===
        inflowId: inflowPeriod.inflowId,
        inflowPeriodId: inflowPeriod.id,
        description: inflowPeriod.description || "Unknown",
        source: inflowPeriod.merchant || inflowPeriod.source || "Unknown",

        // === AMOUNTS ===
        totalExpected: expectedAmount,
        totalReceived: receivedAmount,
        totalPending: pendingAmount,
        averageAmount: inflowPeriod.averageAmount || 0,

        // === STATUS ===
        isReceiptPeriod: inflowPeriod.isReceiptPeriod,
        expectedDate: inflowPeriod.predictedNextDate || undefined,
        isRegularSalary,

        // === PROGRESS METRICS ===
        receiptProgressPercentage,
        isFullyReceived: inflowPeriod.isFullyPaid || false,
        isPending: pendingAmount > 0,

        // === GROUPING ===
        groupId: inflowPeriod.groupId || "",

        // === INCOME TYPE ===
        incomeType,
      };
      entries.push(entry);
    }
  }

  const summary: InflowSummaryData = {
    totalExpectedIncome,
    totalReceivedIncome,
    totalPendingIncome,
    totalCount,
    receiptPeriodCount,
    fullyReceivedCount,
    pendingCount,
  };

  // Add entries if requested
  if (includeEntries) {
    summary.entries = entries;
  }

  console.log(`[calculateInflowSummary] Summary calculated:`, {
    totalExpectedIncome,
    totalReceivedIncome,
    totalPendingIncome,
    totalCount,
    receiptPeriodCount,
    fullyReceivedCount,
    pendingCount,
    entriesCount: entries.length,
  });

  return summary;
}
