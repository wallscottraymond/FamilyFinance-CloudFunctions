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
 */
import { Transaction as FamilyTransaction, PlaidAccount } from '../../../types';
/**
 * Build transaction data from Plaid transaction
 *
 * UPDATED: Creates flat transaction structure with all fields at root level.
 *
 * @param plaidTransaction - Raw transaction data from Plaid
 * @param plaidAccount - Account information
 * @param userId - User ID
 * @param groupId - Group ID (null for private transactions)
 * @param currency - Currency code
 * @param itemId - Plaid item ID
 * @returns Formatted transaction ready for Firestore, or null if formatting fails
 */
export declare function buildTransactionData(plaidTransaction: any, plaidAccount: PlaidAccount, userId: string, groupId: string | undefined, currency: string, itemId: string): Promise<FamilyTransaction | null>;
//# sourceMappingURL=buildTransactionData.d.ts.map