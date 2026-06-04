"use strict";
/**
 * Remove Account Entry Point
 *
 * Cloud Function entry for soft-deleting an account.
 * Requires idempotency key for safe retries.
 *
 * @module entry/callable/remove_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.remove_account = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const accounts_1 = require("../../orchestrators/accounts");
const types_1 = require("../../types");
// Secrets - must be declared at entry point for runtime access
// Required because remove_account calls Plaid's itemRemove which needs:
// 1. Plaid API credentials for authentication
// 2. Decrypted access token for the item being removed
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Input schema for remove_account.
 */
const remove_account_input_schema = zod_1.z.object({
    /** Account ID to remove */
    account_id: zod_1.z.string().min(1, "account_id is required"),
    /** Idempotency key for safe retries (UUID recommended) */
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    /**
     * How to handle transaction history:
     * - keep_history: Transactions hidden but still count in budget totals
     * - delete_history: Transactions hidden AND excluded from budget calculations
     */
    removal_mode: zod_1.z.enum(["keep_history", "delete_history"]).default("keep_history"),
    /** Debug mode enables verbose logging */
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Remove (soft-delete) an account.
 *
 * This operation is idempotent - calling multiple times with the same
 * idempotency_key will return the same result without re-processing.
 *
 * @param request.data.account_id - Account ID to remove
 * @param request.data.idempotency_key - Key for deduplication
 * @param request.data.debug_mode - Enable verbose logging
 * @returns Remove result
 */
exports.remove_account = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{
    maxInstances: 50,
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
}, async (request) => {
    var _a;
    // 1. Authentication check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    // 2. Create trace context (root of trace)
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "remove_account");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 3. Validate input
        const validation = remove_account_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        // 4. Get user's group memberships for access check
        // TODO: Fetch from user profile when user_repo is available
        const user_group_ids = [];
        // 5. Call orchestrator (exactly one)
        const result = await (0, accounts_1.remove_account_orchestrator)(ctx, user_id, {
            account_id: input.account_id,
            idempotency_key: input.idempotency_key,
            removal_mode: input.removal_mode,
        }, user_group_ids);
        // 6. Map response to client DTO
        const response_data = {
            success: result.success,
            account_id: result.account_id,
            was_idempotent: result.was_idempotent,
            removal_type: result.removal_type,
            transaction_count: result.transaction_count,
            outflow_count: result.outflow_count,
            inflow_count: result.inflow_count,
            cascade_jobs_enqueued: result.cascade_jobs_enqueued,
        };
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(response_data, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        // Re-throw HttpsError as-is
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        // Convert DomainError to HttpsError
        if (error instanceof types_1.DomainError) {
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id: ctx.trace_id, code: error.code });
        }
        // Handle idempotency conflict
        if (error instanceof Error &&
            error.message === "Request already in progress") {
            throw new https_1.HttpsError("aborted", "This action is already in progress. Please wait.", { trace_id: ctx.trace_id });
        }
        // Unknown error
        throw new https_1.HttpsError("internal", "Failed to remove account", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=remove_account.entry.js.map