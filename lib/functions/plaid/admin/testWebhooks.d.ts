/**
 * Plaid Webhook Testing Functions
 *
 * These functions trigger Plaid webhooks in the sandbox environment for testing purposes.
 * Based on Plaid's sandbox webhook endpoints:
 * - /sandbox/item/fire_webhook
 * - /sandbox/income/fire_webhook
 * - /sandbox/transfer/fire_webhook
 *
 * IMPORTANT NOTES:
 * - Sandbox items may not have webhooks configured, resulting in SANDBOX_WEBHOOK_INVALID errors
 * - ITEM_LOGIN_REQUIRED errors indicate items need re-authentication via Plaid Link update mode
 * - These functions are for development testing only and should not be used in production
 * - Webhook testing requires active Plaid items with valid access tokens
 *
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Fire a transaction webhook for testing
 */
export declare const fireTransactionWebhook: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    webhook_fired: boolean;
    webhook_code: any;
    item_id: string;
}>, unknown>;
/**
 * Fire an income webhook for testing
 */
export declare const fireIncomeWebhook: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    webhook_fired: boolean;
    webhook_code: any;
    item_id: any;
}>, unknown>;
/**
 * Fire an item webhook for testing
 */
export declare const fireItemWebhook: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    webhook_fired: boolean;
    webhook_code: any;
    item_id: any;
}>, unknown>;
/**
 * Get user's Plaid items for webhook testing
 */
/**
 * Reset item login to force ITEM_LOGIN_REQUIRED error state
 * Uses Plaid's /sandbox/item/reset_login endpoint
 */
export declare const resetItemLogin: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    reset_login: boolean;
    item_id: any;
}>, unknown>;
/**
 * Clear item error state (simulates LOGIN_REPAIRED webhook)
 * Manually restores an item to healthy status for testing
 */
export declare const clearItemError: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    item_id: any;
}>, unknown>;
/**
 * Get user's Plaid items for webhook testing
 */
export declare const getUserPlaidItems: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    items: {
        id: string;
        itemId: any;
        institutionName: any;
        institutionId: any;
        accounts: any;
        status: any;
        lastSyncedAt: any;
    }[];
    count: number;
}>, unknown>;
//# sourceMappingURL=testWebhooks.d.ts.map