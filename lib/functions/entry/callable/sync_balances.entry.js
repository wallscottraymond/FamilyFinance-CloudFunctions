"use strict";
/**
 * Refresh Plaid Data Entry Point
 *
 * Callable function for refreshing BOTH account balances AND transactions from Plaid.
 * Rate limited to once per 5 minutes per item (allows parallel refresh of multiple items).
 *
 * This is the main entry point for pull-to-refresh in the mobile app.
 *
 * @module entry/callable/sync_balances
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.refresh_plaid_data = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const refresh_plaid_data_orchestrator_1 = require("../../orchestrators/plaid/refresh_plaid_data.orchestrator");
const observability_1 = require("../../observability");
const plaid_1 = require("../../types/plaid");
const rate_limiter_1 = require("../../infrastructure/rate_limiter");
// Secrets required for Plaid API calls
const plaidClientId = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const plaidSecret = (0, params_1.defineSecret)("PLAID_SECRET");
const tokenEncryptionKey = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Input validation schema.
 * Accepts camelCase from frontend, converts to snake_case internally.
 */
const sync_balances_input_schema = zod_1.z.object({
    /** Optional: Sync only a specific Plaid item (camelCase from frontend) */
    itemId: zod_1.z.string().optional(),
    /** Optional: Sync only specific account IDs */
    accountIds: zod_1.z.array(zod_1.z.string()).optional(),
});
/**
 * Rate limit configuration for balance sync.
 * 1 request per 5 minutes per item.
 */
const BALANCE_SYNC_RATE_LIMIT = {
    max_requests: 1,
    window_ms: plaid_1.BALANCE_SYNC_RATE_LIMIT_SECONDS * 1000,
};
/**
 * Callable function for syncing account balances AND transactions.
 *
 * Refreshes both balances AND transactions from Plaid for all accounts or specific items.
 * Rate limited to once per 5 minutes per item (allows parallel refresh of multiple items).
 *
 * This is the main pull-to-refresh endpoint for the mobile app.
 *
 * Returns the updated accounts and transaction sync stats in the format expected by the frontend.
 */
exports.refresh_plaid_data = (0, https_1.onCall)({
    memory: "512MiB",
    timeoutSeconds: 120,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (request) => {
    // 1. AUTHENTICATION
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    // 2. INPUT VALIDATION
    const validation = sync_balances_input_schema.safeParse(request.data || {});
    if (!validation.success) {
        throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((e) => e.message).join("; "));
    }
    const input = validation.data;
    // 3. RATE LIMITING (via infrastructure layer, per item)
    const rate_limit_key = `balance_sync:${user_id}:${input.itemId || "all"}`;
    const rate_result = await (0, rate_limiter_1.check_and_record)(rate_limit_key, BALANCE_SYNC_RATE_LIMIT);
    if (!rate_result.allowed) {
        const retry_minutes = Math.ceil((rate_result.retry_after_ms || 0) / 60000);
        throw new https_1.HttpsError("resource-exhausted", `Balance sync is limited to once per ${plaid_1.BALANCE_SYNC_RATE_LIMIT_SECONDS / 60} minutes per account. ` +
            `Please try again in ${retry_minutes} minute${retry_minutes !== 1 ? "s" : ""}.`);
    }
    // 4. CREATE TRACE CONTEXT
    const trace_id = (0, observability_1.generate_id)();
    const span_id = (0, observability_1.generate_id)();
    console.log(`[${trace_id}] refreshPlaidData called by user ${user_id}` +
        (input.itemId ? `, itemId=${input.itemId}` : ""));
    // 5. CALL ORCHESTRATOR (exactly one, convert camelCase to snake_case)
    try {
        const result = await (0, refresh_plaid_data_orchestrator_1.refresh_plaid_data_orchestrator)({
            trace_id,
            span_id,
            input: {
                item_id: input.itemId,
                account_ids: input.accountIds,
            },
            user_id,
            idempotency_key: `refresh_plaid_data:${user_id}:${Date.now()}`,
        });
        // 6. MAP RESPONSE (camelCase for frontend, includes both balance + transaction stats)
        return {
            success: result.success,
            accounts: result.accounts,
            // Balance stats (backward compatible)
            accountsUpdated: result.accounts_updated,
            accountsFailed: result.accounts_failed,
            balanceChanges: result.balance_changes,
            // Transaction stats (new fields)
            transactionsAdded: result.transactions_added,
            transactionsModified: result.transactions_modified,
            transactionsRemoved: result.transactions_removed,
            pendingMigrated: result.pending_migrated,
            // Sync status
            itemsSynced: result.items_synced,
            itemsFailed: result.items_failed,
            itemsRateLimited: result.items_rate_limited,
            // Errors if any
            errors: result.errors,
            traceId: trace_id,
        };
    }
    catch (error) {
        console.error(`[${trace_id}] refreshPlaidData failed:`, error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Failed to refresh Plaid data. Please try again.");
    }
});
//# sourceMappingURL=sync_balances.entry.js.map