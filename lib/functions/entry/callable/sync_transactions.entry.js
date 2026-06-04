"use strict";
/**
 * Sync Transactions Entry Point
 *
 * Callable function for syncing transactions from Plaid.
 * Rate limited to once per 5 minutes per item.
 *
 * NOTE: This only syncs transactions from Plaid to Firestore.
 * Budget calculations are handled by existing Firestore triggers.
 *
 * @module entry/callable/sync_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync_transactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const plaid_1 = require("../../orchestrators/plaid");
const observability_1 = require("../../observability");
const plaid_2 = require("../../types/plaid");
const rate_limiter_1 = require("../../infrastructure/rate_limiter");
// Secrets required for Plaid API calls
const plaidClientId = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const plaidSecret = (0, params_1.defineSecret)("PLAID_SECRET");
const tokenEncryptionKey = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Input validation schema.
 * Accepts camelCase from frontend, converts to snake_case internally.
 */
const sync_transactions_input_schema = zod_1.z.object({
    /** Required: Plaid item document ID to sync */
    itemId: zod_1.z.string().min(1, "itemId is required"),
    /** Optional: Force sync from specific cursor (admin use) */
    cursor: zod_1.z.string().optional(),
});
/**
 * Rate limit configuration for transaction sync.
 * 1 request per 5 minutes per item.
 */
const TRANSACTION_SYNC_RATE_LIMIT = {
    max_requests: 1,
    window_ms: plaid_2.TRANSACTION_SYNC_RATE_LIMIT_SECONDS * 1000,
};
/**
 * Callable function for syncing transactions.
 *
 * Syncs transactions from Plaid for a specific item.
 * Uses cursor-based incremental sync for efficiency.
 * Rate limited to once per 5 minutes per item.
 *
 * Returns sync results including counts of added/modified/removed transactions.
 */
exports.sync_transactions = (0, https_1.onCall)({
    memory: "512MiB",
    timeoutSeconds: 300, // 5 minutes for large syncs
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (request) => {
    // 1. AUTHENTICATION
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    // 2. INPUT VALIDATION
    const validation = sync_transactions_input_schema.safeParse(request.data || {});
    if (!validation.success) {
        throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((e) => e.message).join("; "));
    }
    const input = validation.data;
    // 3. RATE LIMITING (via infrastructure layer, per item)
    const rate_limit_key = `transaction_sync:${user_id}:${input.itemId}`;
    const rate_result = await (0, rate_limiter_1.check_and_record)(rate_limit_key, TRANSACTION_SYNC_RATE_LIMIT);
    if (!rate_result.allowed) {
        const retry_minutes = Math.ceil((rate_result.retry_after_ms || 0) / 60000);
        throw new https_1.HttpsError("resource-exhausted", `Transaction sync is limited to once per ${plaid_2.TRANSACTION_SYNC_RATE_LIMIT_SECONDS / 60} minutes per account. ` +
            `Please try again in ${retry_minutes} minute${retry_minutes !== 1 ? "s" : ""}.`);
    }
    // 4. CREATE TRACE CONTEXT
    const trace_id = (0, observability_1.generate_id)();
    const span_id = (0, observability_1.generate_id)();
    console.log(`[${trace_id}] syncTransactions called by user ${user_id}, itemId=${input.itemId}`);
    // 5. CALL ORCHESTRATOR (exactly one)
    try {
        const result = await (0, plaid_1.sync_transactions_orchestrator)({
            trace_id,
            span_id,
            input: {
                item_id: input.itemId,
                user_id,
                cursor: input.cursor,
            },
            user_id,
            idempotency_key: `sync_transactions:${user_id}:${input.itemId}:${Date.now()}`,
        });
        // 6. MAP RESPONSE (convert snake_case to camelCase for frontend)
        return {
            success: result.success,
            addedCount: result.added_count,
            modifiedCount: result.modified_count,
            removedCount: result.removed_count,
            pendingMigratedCount: result.pending_migrated_count,
            hasMore: result.has_more,
            nextCursor: result.next_cursor,
            error: result.error,
            traceId: trace_id,
        };
    }
    catch (error) {
        console.error(`[${trace_id}] syncTransactions failed:`, error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Failed to sync transactions. Please try again.");
    }
});
//# sourceMappingURL=sync_transactions.entry.js.map