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

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  derive_period_range_orchestrator,
} from "../../orchestrators/periods/derive_period_range.orchestrator";
import { map_derive_period_result } from "./mappers/derive_period.mapper";
import { success_response, FunctionResponse } from "../../types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Same per-window bound as `derive_period`. */
const MAX_WINDOW_MS = 200 * DAY_MS;
/** 12 periods + the current one. */
const MAX_WINDOWS = 13;
/** ~13 months end-to-end (12 monthly periods + the current). */
const MAX_RANGE_MS = 400 * DAY_MS;

const window_schema = z
  .object({
    period_id: z.string().min(1),
    window_start_ms: z.number().int().nonnegative(),
    window_end_ms: z.number().int().nonnegative(),
  })
  .refine((w) => w.window_end_ms >= w.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
  })
  .refine((w) => w.window_end_ms - w.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range",
  });

const schema = z
  .object({
    view_cadence: z.enum(["weekly", "monthly", "bi_monthly"]),
    windows: z.array(window_schema).min(1).max(MAX_WINDOWS),
    force: z.boolean().optional(),
    debug_mode: z.boolean().optional(),
  })
  .refine((d) => new Set(d.windows.map((w) => w.period_id)).size === d.windows.length, {
    message: "duplicate period_id",
  })
  .refine(
    (d) =>
      Math.max(...d.windows.map((w) => w.window_end_ms)) -
        Math.min(...d.windows.map((w) => w.window_start_ms)) <=
      MAX_RANGE_MS,
    { message: "range exceeds the maximum derivable span" }
  );

export const derive_period_range = onCall(
  // Same instance cap as derive_period; a cold 12-month range reads the range's transactions once,
  // so allow a longer timeout + more memory than the single-window call.
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 100, timeoutSeconds: 120, memory: "512MiB" },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_period_range");
    log_operation_start(span, user_id);

    try {
      const validation = schema.safeParse(request.data);
      if (!validation.success) {
        throw new HttpsError(
          "invalid-argument",
          validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
          { trace_id: ctx.trace_id }
        );
      }
      const input = validation.data;
      const result = await derive_period_range_orchestrator(ctx, user_id, {
        view_cadence: input.view_cadence,
        windows: input.windows.map((w) => ({
          period_id: w.period_id,
          start_ms: w.window_start_ms,
          end_ms: w.window_end_ms,
        })),
        force: input.force,
      });

      log_operation_success(span, user_id);
      /* eslint-disable @typescript-eslint/naming-convention -- client wire format */
      return success_response(
        {
          viewCadence: result.view_cadence,
          windows: result.windows.map((w) => ({
            periodId: w.period_id,
            windowStartMs: w.start_ms,
            windowEndMs: w.end_ms,
            derive: map_derive_period_result(w.derive),
            goals: w.goals,
            fromCache: w.from_cache,
          })),
        },
        ctx.trace_id
      );
      /* eslint-enable @typescript-eslint/naming-convention */
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to derive period range", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
