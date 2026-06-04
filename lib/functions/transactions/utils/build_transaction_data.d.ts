/**
 * Transaction Data Builder
 *
 * Transforms raw Plaid transaction data into flat application transaction format.
 * UPDATED: New flat structure without nested access/categories/metadata/relationships objects.
 *
 * Responsibilities:
 * - Plaid data extraction and mapping
 * - Category determination
 * - Transaction split creation with flat structure
 * - Transaction structure building with all fields at root level
 *
 * @module transactions/utils/build_transaction_data
 */
import { Transaction as FamilyTransaction, PlaidAccount } from '../../../types';
/**
 * Build transaction data from Plaid transaction
 *
 * UPDATED: Creates flat transaction structure with all fields at root level.
 *
 * @param plaid_transaction - Raw transaction data from Plaid
 * @param plaid_account - Account information
 * @param user_id - User ID
 * @param group_id - Group ID (null for private transactions)
 * @param currency - Currency code
 * @param item_id - Plaid item ID
 * @returns Formatted transaction ready for Firestore, or null if formatting fails
 */
export declare function build_transaction_data(plaid_transaction: any, plaid_account: PlaidAccount, user_id: string, group_id: string | undefined, currency: string, item_id: string): Promise<FamilyTransaction | null>;
export { build_transaction_data as buildTransactionData };
//# sourceMappingURL=build_transaction_data.d.ts.map