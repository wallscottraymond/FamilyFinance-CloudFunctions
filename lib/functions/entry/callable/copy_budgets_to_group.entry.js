"use strict";
/**
 * Copy Budgets To Group Entry Point (Account-Rooted-Sharing)
 *
 * Copies the caller's budgets into a group (D32); clashes come back as
 * conflicts.
 *
 * @module entry/callable/copy_budgets_to_group
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.copy_budgets_to_group = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const budget_view_orchestrator_1 = require("../../orchestrators/sharing/budget_view.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    group_id: zod_1.z.string().trim().min(1).max(128),
    items: zod_1.z
        .array(zod_1.z.object({
        budget_id: zod_1.z.string().trim().min(1).max(128),
        amount: zod_1.z.number().positive(),
    }))
        .min(1)
        .max(50),
    remove_from_me: zod_1.z.boolean().default(false),
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Copies the caller's budgets into a group (D32); clashes come back as
 * conflicts.
 */
exports.copy_budgets_to_group = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "copy_budgets_to_group");
    (0, observability_1.log_operation_start)(span, user_id);
    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
        (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
            user_id,
            error_code: "VALIDATION_ERROR",
        });
        return (0, types_1.error_response)("VALIDATION_ERROR", validation.error.issues.map((i) => i.message).join("; "), trace.trace_id);
    }
    try {
        const result = await (0, budget_view_orchestrator_1.copy_budgets_to_group_orchestrator)(Object.assign(Object.assign({}, trace), { input: {
                group_id: validation.data.group_id,
                items: validation.data.items,
                remove_from_me: validation.data.remove_from_me,
            }, user_id, idempotency_key: `copy_budgets_to_group:${trace.trace_id}` }));
        if (!result.success) {
            return (0, types_1.error_response)("VALIDATION_ERROR", ((_b = result.errors) !== null && _b !== void 0 ? _b : ["Not allowed"]).join("; "), trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to copy the budgets. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=copy_budgets_to_group.entry.js.map