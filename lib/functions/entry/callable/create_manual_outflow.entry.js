"use strict";
/**
 * Create Manual Outflow Entry Point
 *
 * Creates a recurring bill the user enters by hand (Add Bill). Replaces the
 * app's call to `createRecurringOutflow`, which no longer exists, and the legacy
 * `createManualOutflow`, whose documents the derive path can't read (no root
 * `ownerId`).
 *
 * @module entry/callable/create_manual_outflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_manual_outflow = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const create_manual_outflow_orchestrator_1 = require("../../orchestrators/recurring/create_manual_outflow.orchestrator");
const manual_outflow_service_1 = require("../../domain/recurring/manual_outflow.service");
const types_1 = require("../../types");
/**
 * Input schema. Accepts the app's frequency spelling (`bi_weekly`) too.
 */
const schema = zod_1.z.object({
    name: zod_1.z.string().trim().min(1, "Bill name is required").max(120),
    merchant_name: zod_1.z.string().trim().max(120).optional(),
    amount: zod_1.z.number().positive("Amount must be greater than zero"),
    frequency: zod_1.z
        .string()
        .transform((f) => f.toLowerCase().replace(/_/g, ""))
        .pipe(zod_1.z.enum(manual_outflow_service_1.MANUAL_BILL_FREQUENCIES)),
    expense_type: zod_1.z.string().min(1).max(40).default("other"),
    is_essential: zod_1.z.boolean().default(false),
    due_day: zod_1.z.number().int().min(1).max(31).optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Creates a manual recurring bill.
 *
 * @returns The new outflow ID
 */
exports.create_manual_outflow = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a, _b, _c, _d;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "create_manual_outflow");
    (0, observability_1.log_operation_start)(span, user_id);
    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
        (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
            user_id,
            error_code: "VALIDATION_ERROR",
        });
        return (0, types_1.error_response)("VALIDATION_ERROR", validation.error.issues.map((i) => i.message).join("; "), trace.trace_id);
    }
    const data = validation.data;
    try {
        const result = await (0, create_manual_outflow_orchestrator_1.create_manual_outflow_orchestrator)(Object.assign(Object.assign({}, trace), { input: {
                name: data.name,
                merchant_name: (_b = data.merchant_name) !== null && _b !== void 0 ? _b : null,
                amount: data.amount,
                frequency: data.frequency,
                expense_type: data.expense_type,
                is_essential: data.is_essential,
                due_day: (_c = data.due_day) !== null && _c !== void 0 ? _c : null,
            }, user_id, idempotency_key: `create_manual_outflow:${trace.trace_id}` }));
        if (!result.success || !result.outflow_id) {
            return (0, types_1.error_response)("VALIDATION_ERROR", ((_d = result.errors) !== null && _d !== void 0 ? _d : ["Invalid bill"]).join("; "), trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)({ outflow_id: result.outflow_id }, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to create the bill. Please try again.", trace.trace_id);
    }
});
//# sourceMappingURL=create_manual_outflow.entry.js.map