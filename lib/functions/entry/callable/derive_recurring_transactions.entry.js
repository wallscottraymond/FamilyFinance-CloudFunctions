"use strict";
/**
 * Derive Recurring Transactions Entry Point
 *
 * One callable: all transactions belonging to a recurring inflow/outflow stream,
 * each flagged in-period for the viewed window, so the bill/income detail screen
 * can render "This Period" + "Historical" sections. Read-only.
 *
 * @module entry/callable/derive_recurring_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_recurring_transactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const derive_recurring_transactions_orchestrator_1 = require("../../orchestrators/recurring/derive_recurring_transactions.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    recurring_id: zod_1.z.string().min(1),
    kind: zod_1.z.enum(["outflow", "inflow"]),
    window_start_ms: zod_1.z.number().int().nonnegative(),
    window_end_ms: zod_1.z.number().int().nonnegative(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.derive_recurring_transactions = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 100 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "derive_recurring_transactions");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        const rows = await (0, derive_recurring_transactions_orchestrator_1.derive_recurring_transactions_orchestrator)(ctx, user_id, input.recurring_id, input.kind, input.window_start_ms, input.window_end_ms);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)({
            recurringId: input.recurring_id,
            kind: input.kind,
            transactions: rows.map((r) => ({
                transactionId: r.transaction_id,
                dateMs: r.date_ms,
                name: r.name,
                amount: r.amount,
                isPending: r.is_pending,
                inPeriod: r.in_period,
            })),
        }, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id,
        });
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError("internal", "Failed to derive recurring transactions", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=derive_recurring_transactions.entry.js.map