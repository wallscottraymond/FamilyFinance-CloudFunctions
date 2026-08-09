/**
 * List Suppressed Recurring Entry Point
 *
 * Read-only callable for the recovery screen: returns the user's currently
 * removed/paused recurring bills + income (with computed state). No input.
 *
 * @module entry/callable/list_suppressed_recurring
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  list_suppressed_recurring_orchestrator,
  ListSuppressedRecurringResult,
} from "../../orchestrators/recurring/list_suppressed_recurring.orchestrator";
import { success_response, FunctionResponse } from "../../types";

export const list_suppressed_recurring = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<ListSuppressedRecurringResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "list_suppressed_recurring");
    log_operation_start(span, user_id);

    try {
      const result = await list_suppressed_recurring_orchestrator(ctx, user_id, Date.now());
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );
      throw new HttpsError("internal", "Failed to list suppressed items", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
