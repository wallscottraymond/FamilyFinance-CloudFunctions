"use strict";
/**
 * Derive Budget Transactions Entry Point
 *
 * One callable: the transactions a budget owns FOR A PERIOD, resolved on read,
 * each tagged with a derived spend status (counted / ignored / refund) so the
 * budget-detail screen can show ignored items (incl. auto-ignored transfers) in a
 * dedicated section. Read-only; window hard-bounded.
 *
 * @module entry/callable/derive_budget_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_budget_transactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const derive_budget_transactions_orchestrator_1 = require("../../orchestrators/budgets/derive_budget_transactions.orchestrator");
const types_1 = require("../../types");
const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;
const schema = zod_1.z
    .object({
    budget_id: zod_1.z.string().min(1),
    window_start_ms: zod_1.z.number().int().nonnegative(),
    window_end_ms: zod_1.z.number().int().nonnegative(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((d) => d.window_end_ms >= d.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
})
    .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range",
});
exports.derive_budget_transactions = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 100 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "derive_budget_transactions");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        const rows = await (0, derive_budget_transactions_orchestrator_1.derive_budget_transactions_orchestrator)(ctx, user_id, input.budget_id, input.window_start_ms, input.window_end_ms);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)({
            budgetId: input.budget_id,
            transactions: rows.map((r) => ({
                transactionId: r.transaction_id,
                splitId: r.split_id,
                dateMs: r.date_ms,
                name: r.name,
                amount: r.amount,
                isPending: r.is_pending,
                spendStatus: r.spend_status,
                ignoredReason: r.ignored_reason,
            })),
        }, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id,
        });
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError("internal", "Failed to derive budget transactions", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=derive_budget_transactions.entry.js.map