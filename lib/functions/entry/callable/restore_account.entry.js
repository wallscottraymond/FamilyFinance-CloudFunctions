"use strict";
/**
 * Restore Account Entry Point
 *
 * Cloud Function entry for restoring a soft-deleted account.
 * Only accounts that were single-account removals can be restored.
 *
 * @module entry/callable/restore_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.restore_account = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const restore_account_orchestrator_1 = require("../../orchestrators/accounts/restore_account.orchestrator");
const types_1 = require("../../types");
/**
 * Input schema for restore_account.
 */
const restore_account_input_schema = zod_1.z.object({
    /** Account ID to restore */
    account_id: zod_1.z.string().min(1, "account_id is required"),
    /** Idempotency key for safe retries */
    idempotency_key: zod_1.z.string().min(1, "idempotency_key is required"),
    /** Whether to also restore hidden transactions */
    restore_transactions: zod_1.z.boolean().default(true),
    /** Whether to also restore recurring items */
    restore_recurring: zod_1.z.boolean().default(true),
    /** Debug mode */
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Restore a soft-deleted account.
 *
 * Only accounts that were removed via single-account removal
 * (Plaid item still active) can be restored.
 *
 * @param request.data.account_id - Account ID to restore
 * @param request.data.idempotency_key - Key for deduplication
 * @param request.data.restore_transactions - Whether to un-hide transactions
 * @param request.data.restore_recurring - Whether to restore recurring items
 * @returns Restore result
 */
exports.restore_account = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    // 1. Authentication check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    // 2. Create trace context
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "restore_account");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 3. Validate input
        const validation = restore_account_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        // 4. Get user's group memberships
        const user_group_ids = [];
        // 5. Call orchestrator
        const result = await (0, restore_account_orchestrator_1.restore_account_orchestrator)(ctx, user_id, {
            account_id: input.account_id,
            idempotency_key: input.idempotency_key,
            restore_transactions: input.restore_transactions,
            restore_recurring: input.restore_recurring,
        }, user_group_ids);
        // 6. Map response
        const response_data = {
            success: result.success,
            account_id: result.account_id,
            was_idempotent: result.was_idempotent,
            restore_jobs_enqueued: result.restore_jobs_enqueued,
        };
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(response_data, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        if (error instanceof types_1.DomainError) {
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id: ctx.trace_id, code: error.code });
        }
        if (error instanceof Error &&
            error.message === "Request already in progress") {
            throw new https_1.HttpsError("aborted", "This action is already in progress. Please wait.", { trace_id: ctx.trace_id });
        }
        // Handle restore validation errors
        if (error instanceof Error &&
            error.message.includes("cannot be restored")) {
            throw new https_1.HttpsError("failed-precondition", error.message, { trace_id: ctx.trace_id });
        }
        throw new https_1.HttpsError("internal", "Failed to restore account", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=restore_account.entry.js.map