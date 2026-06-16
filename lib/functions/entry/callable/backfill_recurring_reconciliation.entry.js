"use strict";
/**
 * Backfill Recurring Reconciliation Entry Point
 * (Recurring-Period-Reconciliation Phase 7)
 *
 * Admin/one-shot callable that reconciles existing recurring docs' periods. It
 * does NOT do the work inline — it enqueues a single
 * `backfill_recurring_reconciliation` coordinator job and returns; the job
 * self-fans (per user → per recurring doc → `reconcile_recurring_period`).
 * Idempotent: safe to call repeatedly.
 *
 * Wire contract is snake_case (admin/dev-facing).
 *
 * Scope & auth:
 *   - default (no args): the CALLER's own data.
 *   - `user_id` (other than caller) or `all_users: true`: requires an `admin` claim.
 *
 * @module entry/callable/backfill_recurring_reconciliation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfill_recurring_reconciliation = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const job_queue_1 = require("../../infrastructure/job_queue");
const observability_1 = require("../../observability");
const backfill_input_schema = zod_1.z.object({
    user_id: zod_1.z.string().min(1).optional(),
    all_users: zod_1.z.boolean().optional(),
    /** Regenerate occurrence data before reconciling (fixes legacy/sparse periods). */
    regenerate: zod_1.z.boolean().optional(),
});
exports.backfill_recurring_reconciliation = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ memory: "256MiB", timeoutSeconds: 120 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const caller_uid = request.auth.uid;
    const is_admin = ((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.admin) === true;
    const validation = backfill_input_schema.safeParse(request.data || {});
    if (!validation.success) {
        throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((e) => e.message).join("; "));
    }
    const { user_id, all_users, regenerate } = validation.data;
    const targets_other_user = !!user_id && user_id !== caller_uid;
    if ((all_users || targets_other_user) && !is_admin) {
        throw new https_1.HttpsError("permission-denied", "Backfilling another user or all users requires admin privileges.");
    }
    const trace_id = (0, observability_1.generate_id)();
    const payload = all_users
        ? { regenerate }
        : { user_id: user_id !== null && user_id !== void 0 ? user_id : caller_uid, regenerate };
    const scope = all_users ? "all_users" : payload.user_id;
    console.log(`[${trace_id}] backfill_recurring_reconciliation: caller=${caller_uid}, scope=${scope}`);
    await (0, job_queue_1.create_job)("backfill_recurring_reconciliation", payload, { trace_id });
    return { success: true, enqueued: true, scope, trace_id };
});
//# sourceMappingURL=backfill_recurring_reconciliation.entry.js.map