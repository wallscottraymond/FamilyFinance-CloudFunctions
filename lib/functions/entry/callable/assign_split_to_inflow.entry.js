"use strict";
/**
 * Assign Split → Income Entry Point (Convert-To-Recurring Phase 2)
 *
 * Manually pin a deposit's split to one of the caller's recurring incomes, or clear the pin
 * (`inflow_id: null`). The pin is durable (`inflowAssignmentSource: "manual"`): the assignment
 * engine preserves it across Plaid re-syncs and it beats Plaid stream membership. Owner only;
 * only money coming in; only an income in the transaction's own view. Flag-gated.
 *
 * @module entry/callable/assign_split_to_inflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_split_to_inflow = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const assign_split_to_inflow_orchestrator_1 = require("../../orchestrators/recurring/assign_split_to_inflow.orchestrator");
const types_1 = require("../../types");
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const schema = zod_1.z.object({
    transaction_id: zod_1.z.string().regex(ID, "transaction_id is invalid"),
    split_id: zod_1.z.string().min(1).max(128).regex(/^[^/]+$/, "split_id is invalid"),
    /** The income to pin to; null clears the pin. */
    inflow_id: zod_1.z.string().regex(ID, "inflow_id is invalid").nullable(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.assign_split_to_inflow = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "assign_split_to_inflow");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const { transaction_id, split_id, inflow_id } = validation.data;
        const result = await (0, assign_split_to_inflow_orchestrator_1.assign_split_to_inflow_orchestrator)(ctx, user_id, { transaction_id, split_id, inflow_id });
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError)
            throw error;
        if (error instanceof types_1.ConvertRefusedError) {
            throw new https_1.HttpsError("failed-precondition", error.message, Object.assign({ trace_id: ctx.trace_id, code: error.code }, ((_b = error.details) !== null && _b !== void 0 ? _b : {})));
        }
        if (error instanceof types_1.DomainError) {
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), { trace_id: ctx.trace_id });
        }
        throw new https_1.HttpsError("internal", "Failed to assign the deposit to an income", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=assign_split_to_inflow.entry.js.map