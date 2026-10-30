"use strict";
/**
 * Set Occurrence Settled Entry Point ("Mark as paid" / "Mark as received")
 *
 * Marks ONE occurrence of a recurring bill (`kind: "outflow"`) or income (`kind: "inflow"`)
 * settled by hand — paid in cash / Venmo / from an unlinked account, so no transaction will
 * arrive — or clears the mark (`settled: false`). A real payment that later settles the
 * occurrence wins over the mark (never double-counted). Delegates to the orchestrator.
 *
 * @module entry/callable/set_occurrence_settled
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_occurrence_settled = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const set_occurrence_settled_orchestrator_1 = require("../../orchestrators/recurring/set_occurrence_settled.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    kind: zod_1.z.enum(["outflow", "inflow"]),
    recurring_id: zod_1.z.string().min(1, "recurring_id is required"),
    /** The occurrence's UTC due date. */
    due_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "due_date must be YYYY-MM-DD"),
    settled: zod_1.z.boolean(),
    /** Defaults (server-side) to the occurrence's expected amount. */
    amount: zod_1.z.number().finite().nonnegative().optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.set_occurrence_settled = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "set_occurrence_settled");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const { kind, recurring_id, due_date, settled, amount } = validation.data;
        // TODO(RBAC-Migration): fetch the user's group memberships so a shared item is
        // manageable by any member (same as manage_recurring_*). Owner-authorized until then.
        const user_group_ids = [];
        const result = await (0, set_occurrence_settled_orchestrator_1.set_occurrence_settled_orchestrator)(ctx, user_id, user_group_ids, Object.assign({ kind,
            recurring_id,
            due_date,
            settled }, (amount !== undefined ? { amount } : {})));
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        if (error instanceof types_1.DomainError) {
            // A validation failure carries its own reason (e.g. "not an occurrence of this item").
            const message = error.code === "VALIDATION_ERROR" ? error.message : (0, types_1.get_user_message)(error.code);
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), message, {
                trace_id: ctx.trace_id,
                code: error.code,
            });
        }
        throw new https_1.HttpsError("internal", "Failed to update the occurrence", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=set_occurrence_settled.entry.js.map