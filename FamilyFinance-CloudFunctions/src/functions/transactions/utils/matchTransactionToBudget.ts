/**
 * Transaction-to-Budget Matching Utility
 *
 * Matches transactions to budgets based on date range.
 * Instead of matching to specific budget periods, matches to the parent budget ID.
 * This allows transactions to be tracked across all period types (weekly, monthly, etc.)
 * that share the same budget.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { queryDocuments } from '../../../utils/firestore';

/**
 * Match a transaction to a budget based on its date and category
 *
 * @param userId - User ID
 * @param transactionDate - Date of the transaction
 * @returns Budget match information (budgetId, budgetName)
 */
export async function matchTransactionToBudget(
  userId: string,
  transactionDate: Date
): Promise<{
  budgetId: string | undefined;
  budgetName: string;
}> {
  const transactionTimestamp = Timestamp.fromDate(transactionDate);

  console.log(`🔍 Looking for active budgets for user ${userId}, transaction date: ${transactionDate.toISOString()}`);

  // Query all active budgets for the user
  const budgetsQuery = await queryDocuments('budgets', {
    where: [
      { field: 'createdBy', operator: '==', value: userId },
      { field: 'isActive', operator: '==', value: true }
    ]
  });

  console.log(`📊 Found ${budgetsQuery.length} active budgets for user`);

  // Filter to find budget that contains the transaction date
  for (const budget of budgetsQuery) {
    const budgetData = budget as any;
    const budgetStart = budgetData.startDate;
    const budgetEnd = budgetData.endDate;
    const isOngoing = budgetData.isOngoing !== false; // Default to ongoing if not specified

    console.log(`  💰 Checking budget ${budget.id} (${budgetData.name}): start=${budgetStart}, isOngoing=${isOngoing}`);

    if (budgetStart) {
      const startTimestamp = budgetStart instanceof Timestamp
        ? budgetStart
        : Timestamp.fromDate(new Date(budgetStart));

      // Check if transaction is after budget start date
      const isAfterStart = transactionTimestamp.toMillis() >= startTimestamp.toMillis();

      // For ongoing budgets, only check start date
      // For budgets with end dates, check both start and end
      let isWithinRange = isAfterStart;

      if (!isOngoing && budgetEnd) {
        const endTimestamp = budgetEnd instanceof Timestamp
          ? budgetEnd
          : Timestamp.fromDate(new Date(budgetEnd));

        const isBeforeEnd = transactionTimestamp.toMillis() <= endTimestamp.toMillis();
        isWithinRange = isAfterStart && isBeforeEnd;

        console.log(`  ⏰ Budget range: ${startTimestamp.toDate().toISOString()} to ${endTimestamp.toDate().toISOString()}`);
      } else {
        console.log(`  ⏰ Budget start: ${startTimestamp.toDate().toISOString()} (ongoing)`);
      }

      console.log(`  🎯 Transaction timestamp: ${transactionTimestamp.toDate().toISOString()}`);
      console.log(`  ✔️ In range? ${isWithinRange}`);

      if (isWithinRange) {
        console.log(`  🎉 MATCH! Using budget ${budget.id} (${budgetData.name})`);

        return {
          budgetId: budget.id!,
          budgetName: budgetData.name || 'General'
        };
      }
    }
  }

  console.log(`⚠️ No matching budget found for transaction dated ${transactionDate.toISOString()}`);

  return {
    budgetId: undefined,
    budgetName: 'General'
  };
}
