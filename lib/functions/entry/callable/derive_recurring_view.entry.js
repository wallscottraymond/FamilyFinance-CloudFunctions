"use strict";
/**
 * Derive Recurring View Entry Point
 *
 * Cloud Function entry for the Derive-On-Read Period Architecture (Phase 3):
 * compute a bill/income (recurring outflow) view for a bounded visible window,
 * fresh from the item's schedule + actual payments. Read-only; writes nothing.
 *
 * The window is HARD-BOUNDED here (design guardrail): only the visible window.
 *
 * @module entry/callable/derive_recurring_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_recurring_view = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const derive_recurring_view_orchestrator_1 = require("../../orchestrators/recurring/derive_recurring_view.orchestrator");
const types_1 = require("../../types");
/** Hard cap on the derivable window (~6 months). */
const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;
const derive_recurring_view_input_schema = zod_1.z
    .object({
    kind: zod_1.z.enum(["outflow", "inflow"]),
    recurring_id: zod_1.z.string().min(1, "recurring_id is required"),
    view_cadence: zod_1.z.enum(["weekly", "monthly", "bi_monthly"]),
    window_start_ms: zod_1.z.number().int().nonnegative(),
    window_end_ms: zod_1.z.number().int().nonnegative(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((d) => d.window_end_ms >= d.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
})
    .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range (visible window only)",
});
function map_group_to_response(g) {
    return {
        periodId: g.period_id,
        occurrenceIds: g.occurrence_ids,
        countInPeriod: g.count_in_period,
        countPaid: g.count_paid,
        countUnpaid: g.count_unpaid,
        totalDue: g.total_due,
        totalPaid: g.total_paid,
        totalUnpaid: g.total_unpaid,
        isDuePeriod: g.is_due_period,
        isFullyPaid: g.is_fully_paid,
        isPartiallyPaid: g.is_partially_paid,
        status: g.status,
    };
}
exports.derive_recurring_view = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 100 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "derive_recurring_view");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = derive_recurring_view_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), {
                trace_id: ctx.trace_id,
            });
        }
        const input = validation.data;
        const result = await (0, derive_recurring_view_orchestrator_1.derive_recurring_view_orchestrator)(ctx, user_id, {
            kind: input.kind,
            recurring_id: input.recurring_id,
            view_cadence: input.view_cadence,
            window_start_ms: input.window_start_ms,
            window_end_ms: input.window_end_ms,
        });
        if (!result) {
            throw new https_1.HttpsError("not-found", "Recurring item not found", {
                trace_id: ctx.trace_id,
            });
        }
        const response_data = {
            kind: result.kind,
            recurringId: result.recurring_id,
            name: result.name,
            viewCadence: result.view_cadence,
            groups: result.groups.map(map_group_to_response),
        };
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(response_data, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Failed to derive recurring view", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=derive_recurring_view.entry.js.map