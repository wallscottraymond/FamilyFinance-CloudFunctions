"use strict";
/**
 * Backfill Transaction Assignments Entry Point
 *
 * Admin/one-shot callable that kicks off the assignment-engine backfill after
 * the hard cutover off the legacy increment spend model. It does NOT do the
 * work inline — it enqueues a single `backfill_assignments` coordinator job and
 * returns immediately; the job self-fans (per user → per transaction + per
 * budget) through the `_jobs` queue. Idempotent: safe to call repeatedly.
 *
 * Wire contract is snake_case (admin/dev-facing, no frontend dependency).
 *
 * Scope & auth:
 *   - default (no args): backfills the CALLER's own data.
 *   - `user_id` (other than caller) or `all_users: true`: requires an `admin`
 *     custom claim.
 *
 * @module entry/callable/backfill_transaction_assignments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfill_transaction_assignments = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const job_queue_1 = require("../../infrastructure/job_queue");
const observability_1 = require("../../observability");
/** Input: scope the backfill. Both optional; default = caller's own data. */
const backfill_input_schema = zod_1.z.object({
    /** Backfill a specific user (admin only when not the caller). */
    user_id: zod_1.z.string().min(1).optional(),
    /** Backfill every user (admin only). */
    all_users: zod_1.z.boolean().optional(),
});
exports.backfill_transaction_assignments = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ memory: "256MiB", timeoutSeconds: 120 }, async (request) => {
    var _a;
    // 1. AUTHENTICATION
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const caller_uid = request.auth.uid;
    const is_admin = ((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.admin) === true;
    // 2. INPUT VALIDATION
    const validation = backfill_input_schema.safeParse(request.data || {});
    if (!validation.success) {
        throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((e) => e.message).join("; "));
    }
    const { user_id, all_users } = validation.data;
    // 3. AUTHORIZATION: cross-user / all-users requires admin.
    const targets_other_user = !!user_id && user_id !== caller_uid;
    if ((all_users || targets_other_user) && !is_admin) {
        throw new https_1.HttpsError("permission-denied", "Backfilling another user or all users requires admin privileges.");
    }
    // 4. TRACE CONTEXT
    const trace_id = (0, observability_1.generate_id)();
    // 5. ENQUEUE the coordinator job (no inline work).
    //    all_users → payload with no user_id (orchestrator fans out all users);
    //    otherwise → a single user (the target or the caller).
    const payload = all_users ? {} : { user_id: user_id !== null && user_id !== void 0 ? user_id : caller_uid };
    const scope = all_users
        ? "all_users"
        : payload.user_id;
    console.log(`[${trace_id}] backfill_transaction_assignments: caller=${caller_uid}, scope=${scope}`);
    await (0, job_queue_1.create_job)("backfill_assignments", payload, { trace_id });
    // 6. RESPONSE
    return { success: true, enqueued: true, scope, trace_id };
});
//# sourceMappingURL=backfill_transaction_assignments.entry.js.map