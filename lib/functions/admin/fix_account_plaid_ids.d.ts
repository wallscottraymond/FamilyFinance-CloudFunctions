/**
 * ADMIN: Fix Account PlaidAccountIds
 *
 * This function fixes accounts that are missing the plaidAccountId field.
 * The plaidAccountId should be the same as the accountId field.
 *
 * This is needed because:
 * 1. The new architecture's upsert_from_plaid was not saving plaidAccountId
 * 2. The mobile app uses plaidAccountId to filter transactions
 * 3. Without plaidAccountId, clicking on an account shows no transactions
 *
 * Usage:
 * Call via Firebase Console or httpsCallable
 */
export declare const fix_account_plaid_ids: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    fixed: number;
    already_has_plaid_id: number;
    no_account_id: number;
    total?: undefined;
} | {
    success: boolean;
    message: string;
    fixed: number;
    already_has_plaid_id: number;
    no_account_id: number;
    total: number;
}>, unknown>;
//# sourceMappingURL=fix_account_plaid_ids.d.ts.map