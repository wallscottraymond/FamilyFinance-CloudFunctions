"use strict";
/**
 * Derive Budget View Entry Point
 *
 * Cloud Function entry for the Derive-On-Read Period Architecture (Phase 1):
 * compute a budget's weekly / bi-weekly VIEW for a bounded visible window from
 * the single materialized monthly home. Read-only; deletes/writes nothing.
 *
 * The window is HARD-BOUNDED here (the design's guardrail): a request may not
 * derive an unbounded range — only the visible window (± a little look-ahead).
 *
 * @module entry/callable/derive_budget_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_budget_view = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const derive_budget_view_orchestrator_1 = require("../../orchestrators/budgets/derive_budget_view.orchestrator");
const types_1 = require("../../types");
/** Hard cap on the derivable window (~6 months) — enforces "visible window only". */
const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;
const derive_budget_view_input_schema = zod_1.z
    .object({
    budget_id: zod_1.z.string().min(1, "budget_id is required"),
    view_cadence: zod_1.z.enum(["weekly", "monthly", "bi_monthly"]),
    window_start_ms: zod_1.z.number().int().nonnegative(),
    window_end_ms: zod_1.z.number().int().nonnegative(),
    /** "stored" (interim, reads the assignment) | "on_read" (instant-budget match). */
    match_mode: zod_1.z.enum(["stored", "on_read"]).optional(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((d) => d.window_end_ms >= d.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
})
    .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range (visible window only)",
});
function map_period_to_response(p) {
    return {
        budgetId: p.budget_id,
        periodId: p.period_id,
        periodType: p.period_type,
        periodStart: p.start_ms,
        periodEnd: p.end_ms,
        allocatedAmount: p.allocated_amount,
        effectiveAmount: p.effective_amount,
        spent: p.spent,
        pendingSpent: p.pending_spent,
        returnAmount: p.return_amount,
        remaining: p.remaining,
        isDerived: true,
    };
}
/**
 * Derive a budget's non-monthly view for a bounded window.
 *
 * @returns The derived view periods, or throws not-found if the budget isn't
 *          owned by the caller.
 */
exports.derive_budget_view = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 100 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "derive_budget_view");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = derive_budget_view_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const input = validation.data;
        const result = await (0, derive_budget_view_orchestrator_1.derive_budget_view_orchestrator)(ctx, user_id, {
            budget_id: input.budget_id,
            view_cadence: input.view_cadence,
            window_start_ms: input.window_start_ms,
            window_end_ms: input.window_end_ms,
            match_mode: input.match_mode,
        });
        if (!result) {
            throw new https_1.HttpsError("not-found", "Budget not found", {
                trace_id: ctx.trace_id,
            });
        }
        const response_data = {
            budgetId: result.budget_id,
            budgetName: result.budget_name,
            viewCadence: result.view_cadence,
            periods: result.periods.map(map_period_to_response),
        };
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(response_data, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Failed to derive budget view", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=derive_budget_view.entry.js.map