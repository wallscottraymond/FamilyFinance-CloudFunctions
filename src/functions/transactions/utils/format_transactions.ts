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
 *
 * @module transactions/utils/format_transactions
 */

import { PlaidAccount } from "../../../types";
import { queryDocuments } from "../../../utils/firestore";
import { Transaction as PlaidTransaction } from "plaid";
import { build_transaction_data } from "./build_transaction_data";
import { Transaction as FamilyTransaction } from "../../../types";

/** Firestore `in` takes at most 30 values. */
const ACCOUNT_IN_LIMIT = 30;

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
 * @param added_transactions - Raw transactions from Plaid
 * @param item_id - Plaid item ID
 * @param user_id - User ID
 * @param group_id - Group ID (will be null for now)
 * @param currency - Currency code
 * @returns Array of formatted transactions ready for matching
 */
export async function format_transactions(
  added_transactions: PlaidTransaction[],
  item_id: string,
  user_id: string,
  group_id: string | undefined,
  currency: string
): Promise<FamilyTransaction[]> {
  console.log(`➕ Mapping ${added_transactions.length} Plaid transactions to FamilyTransaction structure`);

  // Failures THROW (P2-H2): the sync saves the Plaid cursor only when nothing failed, so a
  // shorter list here would drop those transactions for good. A throw keeps the cursor where it
  // was and the next sync re-delivers them.
  const account_ids = [...new Set(added_transactions.map((t) => t.account_id))];
  const account_map = new Map<string, PlaidAccount>();
  for (let i = 0; i < account_ids.length; i += ACCOUNT_IN_LIMIT) {
    const account_query = await queryDocuments("accounts", {
      where: [
        { field: "accountId", operator: "in", value: account_ids.slice(i, i + ACCOUNT_IN_LIMIT) },
        { field: "userId", operator: "==", value: user_id },
      ],
    });
    account_query.forEach((account) => {
      const acct = account as unknown as PlaidAccount & { accountId: string };
      account_map.set(acct.accountId, acct);
    });
  }

  const formatted_transactions: FamilyTransaction[] = [];
  for (const plaid_transaction of added_transactions) {
    const account = account_map.get(plaid_transaction.account_id);
    if (!account) {
      throw new Error(
        `Account ${plaid_transaction.account_id} not found for transaction ${plaid_transaction.transaction_id}`
      );
    }
    // Build the transaction data using extracted utility (no DB calls)
    formatted_transactions.push(
      await build_transaction_data(plaid_transaction, account, user_id, group_id, currency, item_id)
    );
  }

  console.log(`✅ Mapped ${formatted_transactions.length} of ${added_transactions.length} Plaid transactions to FamilyTransaction structure`);
  return formatted_transactions;
}

// Re-export utilities for backward compatibility
export { match_categories_to_transactions } from "./match_categories_to_transactions";
export { match_transaction_to_budget } from "./match_transaction_to_budget";

// Legacy exports for backward compatibility during migration
export { format_transactions as formatTransactions };
