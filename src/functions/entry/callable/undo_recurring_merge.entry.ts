/**
 * Undo Recurring Merge Entry Point (Convert-To-Recurring Phase 2): undo a same-bill merge (the old
 * bill is restored) or an absorbed Plaid stream (the next sync makes it a separate bill). Owner
 * only; flag-gated.
 *
 * @module entry/callable/undo_recurring_merge
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_trace_context, create_span, log_operation_start, log_operation_success, log_operation_error } from "../../observability";
import { undo_recurring_merge_orchestrator } from "../../orchestrators/recurring/undo_recurring_merge.orchestrator";
import { success_response, FunctionResponse, ConvertRefusedError, DomainError, get_https_error_code, get_user_message } from "../../types";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const schema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("merge"), kind: z.enum(["outflow", "inflow"]), record_id: z.string().regex(ID), debug_mode: z.boolean().optional() }),
  z.object({ mode: z.literal("absorb"), kind: z.enum(["outflow", "inflow"]), record_id: z.string().regex(ID), stream_id: z.string().regex(ID), debug_mode: z.boolean().optional() }),
]);

export const undo_recurring_merge = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "undo_recurring_merge");
    log_operation_start(span, user_id);
    try {
      const v = schema.safeParse(request.data);
      if (!v.success) {
        throw new HttpsError("invalid-argument", v.error.issues.map((i: z.ZodIssue) => i.message).join("; "), { trace_id: ctx.trace_id });
      }
      const { debug_mode: _d, ...input } = v.data;
      void _d;
      const result = await undo_recurring_merge_orchestrator(ctx, user_id, input, Date.now());
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
      if (error instanceof HttpsError) throw error;
      if (error instanceof ConvertRefusedError) {
        throw new HttpsError("failed-precondition", error.message, { trace_id: ctx.trace_id, code: error.code });
      }
      if (error instanceof DomainError) {
        throw new HttpsError(get_https_error_code(error), get_user_message(error.code), { trace_id: ctx.trace_id });
      }
      throw new HttpsError("internal", "Failed to undo", { trace_id: ctx.trace_id });
    }
  }
);
