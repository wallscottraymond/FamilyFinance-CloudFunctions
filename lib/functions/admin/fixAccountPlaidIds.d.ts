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
 * firebase functions:call fixAccountPlaidIds
 */
export declare const fixAccountPlaidIds: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    fixed: number;
    alreadyHasPlaidId: number;
    noAccountId: number;
    total?: undefined;
} | {
    success: boolean;
    message: string;
    fixed: number;
    alreadyHasPlaidId: number;
    noAccountId: number;
    total: number;
}>, unknown>;
//# sourceMappingURL=fixAccountPlaidIds.d.ts.map