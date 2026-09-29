/**
 * Derive Period Entry Point (batched)
 *
 * One callable that derives a whole period view — budgets, bills, income — for a
 * cadence + window, on read. Replaces ~N per-item calls with one round-trip.
 * Read-only; window hard-bounded.
 *
 * @module entry/callable/derive_period
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
  derive_period_orchestrator,
} from "../../orchestrators/periods/derive_period.orchestrator";
import { map_derive_period_result } from "./mappers/derive_period.mapper";
import { success_response, FunctionResponse } from "../../types";

const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;

const schema = z
  .object({
    view_cadence: z.enum(["weekly", "monthly", "bi_monthly"]),
    window_start_ms: z.number().int().nonnegative(),
    window_end_ms: z.number().int().nonnegative(),
    // Bypass the server cache and recompute fresh (then overwrite the cache). The FE sets this
    // right after a user config change (budget/bill/goal) so the edit reflects immediately
    // instead of waiting out the version-bump race / TTL backstop.
    force: z.boolean().optional(),
    debug_mode: z.boolean().optional(),
  })
  .refine((d) => d.window_end_ms >= d.window_start_ms, { message: "window_end_ms must be >= window_start_ms" })
  .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range (visible window only)",
  });

export const derive_period = onCall(
  // Cold-start is absorbed client-side (stale-while-revalidate cache), so no
  // minInstances cost. maxInstances caps fan-out.
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 100 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_period");
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
      const result = await derive_period_orchestrator(ctx, user_id, {
        view_cadence: input.view_cadence,
        window_start_ms: input.window_start_ms,
        window_end_ms: input.window_end_ms,
        force: input.force,
      });

      log_operation_success(span, user_id);
      return success_response(map_derive_period_result(result), ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to derive period", { trace_id: ctx.trace_id });
    }
  }
);
