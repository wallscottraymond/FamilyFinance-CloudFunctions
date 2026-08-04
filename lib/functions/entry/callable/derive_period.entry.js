"use strict";
/**
 * Derive Period Entry Point (batched)
 *
 * One callable that derives a whole period view — budgets, bills, income — for a
 * cadence + window, on read. Replaces ~N per-item calls with one round-trip.
 * Read-only; window hard-bounded.
 *
 * @module entry/callable/derive_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_period = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const derive_period_orchestrator_1 = require("../../orchestrators/periods/derive_period.orchestrator");
const types_1 = require("../../types");
const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;
const schema = zod_1.z
    .object({
    view_cadence: zod_1.z.enum(["weekly", "monthly", "bi_monthly"]),
    window_start_ms: zod_1.z.number().int().nonnegative(),
    window_end_ms: zod_1.z.number().int().nonnegative(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((d) => d.window_end_ms >= d.window_start_ms, { message: "window_end_ms must be >= window_start_ms" })
    .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range (visible window only)",
});
function map_budget(b) {
    return {
        budgetId: b.budget_id,
        name: b.name,
        isEverythingElse: b.is_everything_else,
        periods: b.periods.map((p) => ({
            periodId: p.period_id,
            periodType: p.period_type,
            allocatedAmount: p.allocated_amount,
            effectiveAmount: p.effective_amount,
            spent: p.spent,
            returnAmount: p.return_amount,
            remaining: p.remaining,
            isDerived: true,
        })),
    };
}
function map_recurring(r) {
    return {
        recurringId: r.recurring_id,
        name: r.name,
        groups: r.groups.map((g) => ({
            periodId: g.period_id,
            countInPeriod: g.count_in_period,
            countPaid: g.count_paid,
            totalDue: g.total_due,
            totalPaid: g.total_paid,
            totalUnpaid: g.total_unpaid,
            isDuePeriod: g.is_due_period,
            isFullyPaid: g.is_fully_paid,
            status: g.status,
        })),
    };
}
exports.derive_period = (0, https_1.onCall)(
// Cold-start is absorbed client-side (stale-while-revalidate cache), so no
// minInstances cost. maxInstances caps fan-out.
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 100 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "derive_period");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        const result = await (0, derive_period_orchestrator_1.derive_period_orchestrator)(ctx, user_id, {
            view_cadence: input.view_cadence,
            window_start_ms: input.window_start_ms,
            window_end_ms: input.window_end_ms,
        });
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)({
            viewCadence: result.view_cadence,
            budgets: result.budgets.map(map_budget),
            bills: result.bills.map(map_recurring),
            income: result.income.map(map_recurring),
        }, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError("internal", "Failed to derive period", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=derive_period.entry.js.map