"use strict";
/**
 * Derive Period RANGE Entry Point (read-only)
 *
 * One callable that derives many period windows of a cadence (the Home preload: the last 12
 * periods) — each window's `derive_period` result AND its `derive_goals_view` result — reading the
 * user's definitions + the range's transactions once. Per window the payload is identical to
 * calling `derive_period` / `derive_goals_view` for that window.
 *
 * @module entry/callable/derive_period_range
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_period_range = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const derive_period_range_orchestrator_1 = require("../../orchestrators/periods/derive_period_range.orchestrator");
const derive_period_mapper_1 = require("./mappers/derive_period.mapper");
const types_1 = require("../../types");
const DAY_MS = 24 * 60 * 60 * 1000;
/** Same per-window bound as `derive_period`. */
const MAX_WINDOW_MS = 200 * DAY_MS;
/** 12 periods + the current one. */
const MAX_WINDOWS = 13;
/** ~13 months end-to-end (12 monthly periods + the current). */
const MAX_RANGE_MS = 400 * DAY_MS;
const window_schema = zod_1.z
    .object({
    period_id: zod_1.z.string().min(1),
    window_start_ms: zod_1.z.number().int().nonnegative(),
    window_end_ms: zod_1.z.number().int().nonnegative(),
})
    .refine((w) => w.window_end_ms >= w.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
})
    .refine((w) => w.window_end_ms - w.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range",
});
const schema = zod_1.z
    .object({
    view_cadence: zod_1.z.enum(["weekly", "monthly", "bi_monthly"]),
    windows: zod_1.z.array(window_schema).min(1).max(MAX_WINDOWS),
    force: zod_1.z.boolean().optional(),
    debug_mode: zod_1.z.boolean().optional(),
})
    .refine((d) => new Set(d.windows.map((w) => w.period_id)).size === d.windows.length, {
    message: "duplicate period_id",
})
    .refine((d) => Math.max(...d.windows.map((w) => w.window_end_ms)) -
    Math.min(...d.windows.map((w) => w.window_start_ms)) <=
    MAX_RANGE_MS, { message: "range exceeds the maximum derivable span" });
exports.derive_period_range = (0, https_1.onCall)(
// Same instance cap as derive_period; a cold 12-month range reads the range's transactions once,
// so allow a longer timeout + more memory than the single-window call.
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 100, timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "derive_period_range");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        const result = await (0, derive_period_range_orchestrator_1.derive_period_range_orchestrator)(ctx, user_id, {
            view_cadence: input.view_cadence,
            windows: input.windows.map((w) => ({
                period_id: w.period_id,
                start_ms: w.window_start_ms,
                end_ms: w.window_end_ms,
            })),
            force: input.force,
        });
        (0, observability_1.log_operation_success)(span, user_id);
        /* eslint-disable @typescript-eslint/naming-convention -- client wire format */
        return (0, types_1.success_response)({
            viewCadence: result.view_cadence,
            windows: result.windows.map((w) => ({
                periodId: w.period_id,
                windowStartMs: w.start_ms,
                windowEndMs: w.end_ms,
                derive: (0, derive_period_mapper_1.map_derive_period_result)(w.derive),
                goals: w.goals,
                fromCache: w.from_cache,
            })),
        }, ctx.trace_id);
        /* eslint-enable @typescript-eslint/naming-convention */
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError)
            throw error;
        throw new https_1.HttpsError("internal", "Failed to derive period range", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=derive_period_range.entry.js.map