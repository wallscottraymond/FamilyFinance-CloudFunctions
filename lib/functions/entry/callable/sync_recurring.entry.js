"use strict";
/**
 * Sync Recurring Entry Point
 *
 * Callable function for syncing recurring transactions (inflows/outflows) from Plaid.
 * Rate limited to once per 15 minutes per item.
 *
 * @module entry/callable/sync_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync_recurring = void 0;
const sync_item_orchestrator_1 = require("../../orchestrators/plaid/sync_item.orchestrator");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const rate_limiter_1 = require("../../infrastructure/rate_limiter");
// Secrets required for Plaid API calls
const plaidClientId = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const plaidSecret = (0, params_1.defineSecret)("PLAID_SECRET");
const tokenEncryptionKey = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Rate limit: 15 minutes between recurring syncs per item.
 * Recurring detection doesn't change frequently, so longer window is appropriate.
 */
const RECURRING_SYNC_RATE_LIMIT_SECONDS = 900; // 15 minutes
/**
 * Input validation schema.
 * Accepts camelCase from frontend, converts to snake_case internally.
 */
const sync_recurring_input_schema = zod_1.z.object({
    /** Required: Plaid item document ID to sync */
    itemId: zod_1.z.string().min(1, "itemId is required"),
    /** Optional: Specific account IDs to sync */
    accountIds: zod_1.z.array(zod_1.z.string()).optional(),
});
/**
 * Rate limit configuration for recurring sync.
 * 1 request per 15 minutes per item.
 */
const RECURRING_SYNC_RATE_LIMIT = {
    max_requests: 1,
    window_ms: RECURRING_SYNC_RATE_LIMIT_SECONDS * 1000,
};
/**
 * Callable function for syncing recurring transactions.
 *
 * Syncs recurring inflows and outflows from Plaid for a specific item.
 * Detects new recurring patterns, updates existing ones, and marks stale items.
 * Rate limited to once per 15 minutes per item.
 *
 * Returns sync results including counts of synced inflows/outflows.
 */
exports.sync_recurring = (0, https_1.onCall)({
    memory: "512MiB",
    timeoutSeconds: 120, // 2 minutes should be plenty for recurring sync
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (request) => {
    // 1. AUTHENTICATION
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    // 2. INPUT VALIDATION
    const validation = sync_recurring_input_schema.safeParse(request.data || {});
    if (!validation.success) {
        throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((e) => e.message).join("; "));
    }
    const input = validation.data;
    // 3. RATE LIMITING (via infrastructure layer, per item)
    const rate_limit_key = `recurring_sync:${user_id}:${input.itemId}`;
    const rate_result = await (0, rate_limiter_1.check_and_record)(rate_limit_key, RECURRING_SYNC_RATE_LIMIT);
    if (!rate_result.allowed) {
        const retry_minutes = Math.ceil((rate_result.retry_after_ms || 0) / 60000);
        throw new https_1.HttpsError("resource-exhausted", `Recurring sync is limited to once per ${RECURRING_SYNC_RATE_LIMIT_SECONDS / 60} minutes per account. ` +
            `Please try again in ${retry_minutes} minute${retry_minutes !== 1 ? "s" : ""}.`);
    }
    // 4. CREATE TRACE CONTEXT
    const trace_id = (0, observability_1.generate_id)();
    const span_id = (0, observability_1.generate_id)();
    console.log(`[${trace_id}] syncRecurring called by user ${user_id}, itemId=${input.itemId}`);
    // 5. CALL ORCHESTRATOR (exactly one)
    try {
        // Through the item sync with recurring (lease + one pass).
        const synced = await (0, sync_item_orchestrator_1.sync_item_orchestrator)({ trace_id, span_id }, { item_doc_id: input.itemId, user_id, recurring: true, reason: "callable:syncRecurring" });
        const result = {
            success: synced.status !== "failed",
            inflows_synced: synced.streams_written,
            outflows_synced: 0,
            inflows_stale: 0,
            outflows_stale: 0,
            merge_suggestions: 0,
            errors: undefined,
            error: synced.error,
        };
        // 6. MAP RESPONSE (convert snake_case to camelCase for frontend)
        return {
            success: result.success,
            inflowsSynced: result.inflows_synced,
            outflowsSynced: result.outflows_synced,
            inflowsStale: result.inflows_stale,
            outflowsStale: result.outflows_stale,
            mergeSuggestions: result.merge_suggestions,
            errors: result.errors,
            error: result.error,
            traceId: trace_id,
        };
    }
    catch (error) {
        console.error(`[${trace_id}] syncRecurring failed:`, error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Failed to sync recurring transactions. Please try again.");
    }
});
//# sourceMappingURL=sync_recurring.entry.js.map