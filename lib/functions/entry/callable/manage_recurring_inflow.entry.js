"use strict";
/**
 * Manage Recurring Inflow Entry Point
 *
 * One callable for the Remove-Recover-Recurring actions on a recurring income:
 * `remove` (all / going_forward), `pause` (until a date), `restore` (forward-only
 * resume), and `delete` (permanent). Delegates to the generic manage orchestrator
 * with the inflow repo.
 *
 * @module entry/callable/manage_recurring_inflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manage_recurring_inflow = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const manage_recurring_removal_orchestrator_1 = require("../../orchestrators/recurring/manage_recurring_removal.orchestrator");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const types_1 = require("../../types");
const schema = zod_1.z.intersection(zod_1.z.object({
    inflow_id: zod_1.z.string().min(1, "inflow_id is required"),
    debug_mode: zod_1.z.boolean().optional(),
}), zod_1.z.discriminatedUnion("action", [
    zod_1.z.object({ action: zod_1.z.literal("remove"), mode: zod_1.z.enum(["all", "going_forward"]) }),
    zod_1.z.object({ action: zod_1.z.literal("pause"), resume_ms: zod_1.z.number().int().positive() }),
    zod_1.z.object({ action: zod_1.z.literal("restore") }),
    zod_1.z.object({ action: zod_1.z.literal("delete") }),
]));
exports.manage_recurring_inflow = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "manage_recurring_inflow");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const data = validation.data;
        let input;
        if (data.action === "remove") {
            input = { id: data.inflow_id, action: "remove", mode: data.mode };
        }
        else if (data.action === "pause") {
            input = { id: data.inflow_id, action: "pause", resume_ms: data.resume_ms };
        }
        else if (data.action === "restore") {
            input = { id: data.inflow_id, action: "restore" };
        }
        else {
            input = { id: data.inflow_id, action: "delete" };
        }
        // TODO(RBAC-Migration): fetch the user's group memberships.
        const user_group_ids = [];
        const now_ms = Date.now();
        const result = await (0, manage_recurring_removal_orchestrator_1.manage_recurring_removal_orchestrator)(ctx, user_id, user_group_ids, input, now_ms, inflow_repo_1.inflow_repo, "recurring_inflow");
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)({
            /* eslint-disable @typescript-eslint/naming-convention */
            inflow_id: result.id,
            action: result.action,
            deleted: result.deleted,
            state: result.state,
            /* eslint-enable @typescript-eslint/naming-convention */
        }, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        if (error instanceof types_1.DomainError) {
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id: ctx.trace_id, code: error.code });
        }
        throw new https_1.HttpsError("internal", "Failed to manage recurring inflow", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=manage_recurring_inflow.entry.js.map