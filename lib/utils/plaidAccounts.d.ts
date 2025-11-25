/**
 * Plaid Account Management Utilities
 *
 * Handles account data retrieval and storage operations
 */
import { PlaidApi } from 'plaid';
export interface ProcessedAccount {
    id: string;
    name: string;
    type: string;
    subtype: string | null;
    currentBalance: number;
    availableBalance: number | null;
    currencyCode: string;
    mask: string | null;
    officialName: string | null;
}
/**
 * Retrieves account details from Plaid
 */
export declare function fetchPlaidAccounts(plaidClient: PlaidApi, accessToken: string, itemId: string): Promise<ProcessedAccount[]>;
/**
 * Saves Plaid item data to Firestore
 */
export declare function savePlaidItem(itemId: string, userId: string, institutionId: string, institutionName: string, accessToken: string): Promise<void>;
/**
 * Saves account documents to Firestore accounts collection using hybrid structure
 */
export declare function savePlaidAccounts(accounts: ProcessedAccount[], itemId: string, userId: string, institutionId: string, institutionName: string, groupId?: string | null): Promise<void>;
//# sourceMappingURL=plaidAccounts.d.ts.map