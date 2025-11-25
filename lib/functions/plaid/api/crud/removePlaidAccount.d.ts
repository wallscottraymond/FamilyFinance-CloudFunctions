/**
 * Remove Plaid Account Cloud Function
 *
 * Removes a Plaid-linked account by:
 * 1. Looking up account to get itemId
 * 2. Retrieving access token from plaid_items
 * 3. Calling Plaid itemRemove API to unlink
 * 4. Soft-deleting account (isActive: false)
 * 5. Optionally marking item inactive if no other accounts exist
 *
 * Security: User authentication required (VIEWER role)
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Remove Plaid Account callable function
 */
export declare const removePlaidAccount: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    accountId: any;
    itemId: any;
    plaidRemovalSuccess: boolean;
    itemStillActive: boolean;
}>>;
//# sourceMappingURL=removePlaidAccount.d.ts.map