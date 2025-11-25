/**
 * User Data Cleanup Functions
 *
 * Administrative functions for removing test data during development.
 * These functions delete all user-associated data from various collections.
 *
 * ⚠️ WARNING: These functions permanently delete data. Use with caution.
 *
 * Functions:
 * - removeAllUserAccounts: Deletes Plaid items, accounts, and tokens
 * - removeAllUserBudgets: Deletes budgets and budget periods
 * - removeAllUserOutflows: Deletes outflow transactions
 * - removeAllUserInflows: Deletes inflow transactions
 * - removeAllUserTransactions: Deletes all transactions
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */
interface CleanupResponse {
    success: boolean;
    itemsDeleted: number;
    errors: string[];
    message: string;
}
/**
 * Remove all Plaid accounts, items, and associated data for a user
 */
export declare const removeAllUserAccounts: import("firebase-functions/v2/https").CallableFunction<any, Promise<CleanupResponse>>;
/**
 * Remove all budgets and budget periods for a user
 */
export declare const removeAllUserBudgets: import("firebase-functions/v2/https").CallableFunction<any, Promise<CleanupResponse>>;
/**
 * Remove all outflow transactions for a user
 */
export declare const removeAllUserOutflows: import("firebase-functions/v2/https").CallableFunction<any, Promise<CleanupResponse>>;
/**
 * Remove all inflow transactions for a user
 */
export declare const removeAllUserInflows: import("firebase-functions/v2/https").CallableFunction<any, Promise<CleanupResponse>>;
/**
 * Remove all transactions for a user (including manual and Plaid transactions)
 */
export declare const removeAllUserTransactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<CleanupResponse>>;
/**
 * Nuclear option: Remove ALL user data across all collections
 */
export declare const removeAllUserData: import("firebase-functions/v2/https").CallableFunction<any, Promise<CleanupResponse>>;
export {};
//# sourceMappingURL=cleanupUserData.d.ts.map