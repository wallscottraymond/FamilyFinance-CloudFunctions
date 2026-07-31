"use strict";
/**
 * Purge User Data Entry Point
 *
 * Callable that kicks off a FULL, PERMANENT erase of a user. It does NOT delete
 * anything itself (a large user would time out) — it validates, blocks unsafe
 * cases, writes the `purge_status/{uid}` doc, and enqueues the async
 * `purge_user_data` job. The FE listens to the status doc for live progress.
 *
 * Auth: a user may purge their OWN uid; an ADMIN (custom claim) may purge any
 * uid. A fixed confirmation phrase is re-checked server-side (defense in depth).
 *
 * Groups: if the target owns a group with other members, the purge is BLOCKED
 * (status `blocked` + the group list returned) so a shared group is never
 * orphaned — the user must transfer ownership first.
 *
 * @module entry/callable/purge_user_data
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.purge_user_data = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const purge_guard_1 = require("../../infrastructure/purge_guard");
const purge_repo_1 = require("../../repositories/purge.repo");
const types_1 = require("../../types");
/** The exact phrase the client must send (matched server-side too). */
const CONFIRMATION_PHRASE = "DELETE MY DATA";
const purge_user_data_input_schema = zod_1.z.object({
    /** Must equal the fixed confirmation phrase. */
    confirmation_phrase: zod_1.z.string(),
    /** Admin-only: purge a DIFFERENT user. Omit to purge yourself. */
    target_user_id: zod_1.z.string().min(1).optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.purge_user_data = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 10 }, async (request) => {
    var _a, _b, _c;
    // 1. Auth
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const caller_uid = request.auth.uid;
    const is_admin = ((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.admin) === true;
    const ctx = (0, observability_1.create_trace_context)(((_b = request.data) === null || _b === void 0 ? void 0 : _b.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "purge_user_data");
    (0, observability_1.log_operation_start)(span, caller_uid);
    try {
        // 2. Validate
        const validation = purge_user_data_input_schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        // 3. Confirmation phrase (defense in depth — the FE also gates on this).
        if (input.confirmation_phrase !== CONFIRMATION_PHRASE) {
            throw new https_1.HttpsError("failed-precondition", "Confirmation phrase does not match.", { trace_id: ctx.trace_id });
        }
        // 4. Resolve target: self, or (admin-only) another user.
        const target_uid = (_c = input.target_user_id) !== null && _c !== void 0 ? _c : caller_uid;
        if (target_uid !== caller_uid && !is_admin) {
            throw new https_1.HttpsError("permission-denied", "Only an admin can purge another user.", { trace_id: ctx.trace_id });
        }
        // 5. Groups pre-check — never orphan a shared group the user owns.
        const shared_groups = await (0, purge_repo_1.find_owned_shared_groups)(target_uid);
        if (shared_groups.length > 0) {
            await (0, purge_guard_1.set_purge_status)(target_uid, {
                state: "blocked",
                initiated_by: caller_uid,
                blocked_reason: "owns_group_with_members",
                blocked_groups: shared_groups,
            });
            (0, observability_1.log_operation_success)(span, caller_uid);
            return (0, types_1.success_response)({
                blocked: true,
                blocked_reason: "owns_group_with_members",
                blocked_groups: shared_groups,
                user_id: target_uid,
                status_doc_path: `${purge_guard_1.PURGE_STATUS_COLLECTION}/${target_uid}`,
            }, ctx.trace_id);
        }
        // 6. Mark requested (this doc is ALSO the guard read background writers
        //    honor) + enqueue the async purge job.
        await (0, purge_guard_1.set_purge_status)(target_uid, {
            state: "requested",
            initiated_by: caller_uid,
        });
        await (0, job_queue_1.create_job)("purge_user_data", {
            user_id: target_uid,
            initiated_by: caller_uid,
            trace_id: ctx.trace_id,
        }, { trace_id: ctx.trace_id });
        (0, observability_1.log_operation_success)(span, caller_uid);
        return (0, types_1.success_response)({
            blocked: false,
            user_id: target_uid,
            status_doc_path: `${purge_guard_1.PURGE_STATUS_COLLECTION}/${target_uid}`,
        }, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: caller_uid });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Failed to start purge", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=purge_user_data.entry.js.map