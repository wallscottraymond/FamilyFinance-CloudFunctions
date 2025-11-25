/**
 * Transaction Formatting Utilities
 *
 * This module handles pure Plaid-to-Transaction data mapping.
 * It builds transaction structures with null values for fields that will be
 * populated by subsequent matching functions.
 *
 * Responsibilities:
 * - Fetching account information
 * - Mapping Plaid transactions to FamilyTransaction structure
 * - Building transaction arrays for batch processing (no DB writes)
 */

import { PlaidAccount } from '../../../types';
import { queryDocuments } from '../../../utils/firestore';
import { Transaction as PlaidTransaction } from 'plaid';
import { buildTransactionData } from './buildTransactionData';
import { Transaction as FamilyTransaction } from '../../../types';

/**
 * Format transactions from Plaid sync data (pure mapping, no DB writes)
 *
 * Maps Plaid transactions to FamilyTransaction structure with null values
 * for fields that will be populated by subsequent matching functions.
 *
 * Flow:
 * 1. Fetch account information
 * 2. Map each Plaid transaction to FamilyTransaction structure
 * 3. Return array of transactions (no DB operations)
 *
 * @param addedTransactions - Raw transactions from Plaid
 * @param itemId - Plaid item ID
 * @param userId - User ID
 * @param groupId - Group ID (will be null for now)
 * @param currency - Currency code
 * @returns Array of formatted transactions ready for matching
 */
export async function formatTransactions(
  addedTransactions: PlaidTransaction[],
  itemId: string,
  userId: string,
  groupId: string | undefined,
  currency: string
): Promise<FamilyTransaction[]> {
  console.log(`➕ Mapping ${addedTransactions.length} Plaid transactions to FamilyTransaction structure`);

  const formattedTransactions: FamilyTransaction[] = [];

  try {
    // Get account information for transactions
    const accountIds = [...new Set(addedTransactions.map(t => t.account_id))];
    console.log(`Looking for ${accountIds.length} unique accounts`);

    const accountQuery = await queryDocuments('accounts', {
      where: [
        { field: 'accountId', operator: 'in', value: accountIds },
        { field: 'userId', operator: '==', value: userId }
      ]
    });

    const accountMap = new Map<string, PlaidAccount>();
    accountQuery.forEach(account => {
      accountMap.set((account as any).accountId, account as PlaidAccount);
    });

    console.log(`Found ${accountMap.size} accounts`);

    // Process each transaction individually
    for (const plaidTransaction of addedTransactions) {
      try {
        const account = accountMap.get(plaidTransaction.account_id);
        if (!account) {
          console.warn(`Account not found for transaction: ${plaidTransaction.transaction_id}`);
          continue;
        }

        // Build the transaction data using extracted utility (no DB calls)
        const formattedTransaction = await buildTransactionData(
          plaidTransaction,
          account,
          userId,
          groupId,
          currency,
          itemId
        );

        // Add to array (no DB write yet)
        if (formattedTransaction) {
          formattedTransactions.push(formattedTransaction);
        }
      } catch (error) {
        console.error(`Error mapping transaction ${plaidTransaction.transaction_id}:`, error);
      }
    }

    console.log(`✅ Mapped ${formattedTransactions.length} of ${addedTransactions.length} Plaid transactions to FamilyTransaction structure`);

    return formattedTransactions;

  } catch (error) {
    console.error('Error formatting transactions:', error);
    return formattedTransactions; // Return partial results
  }
}

// Re-export utilities for backward compatibility
export { matchCategoriesToTransactions } from './matchCategoriesToTransactions';
export { matchTransactionToBudget } from './matchTransactionToBudget';
