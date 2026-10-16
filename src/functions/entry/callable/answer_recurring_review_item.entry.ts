/**
 * Answer Recurring Review Item Entry Point (Convert-To-Recurring Phase 1)
 *
 * One tap on a Bills-to-review tile: Track this bill / Not a bill (suggestions), Still a bill /
 * It ended, Keep separate. Owner-only (D15 / D24): the item id must be the caller's own; a group
 * member gets PermissionDenied. Delegates to the orchestrator.
 *
 * @module entry/callable/answer_recurring_review_item
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
import { answer_recurring_review_item_orchestrator } from "../../orchestrators/recurring/answer_recurring_review_item.orchestrator";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

const schema = z.object({
  item_id: z.string().min(1, "item_id is required").max(300),
  answer: z.enum(["track", "not_bill", "still_a_bill", "it_ended", "keep_separate", "same_bill"]),
  frequency: z.enum(["weekly", "biweekly", "semimonthly", "monthly", "yearly"]).nullable().optional(),
  debug_mode: z.boolean().optional(),
});

export const answer_recurring_review_item = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "answer_recurring_review_item");
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
      const { item_id, answer, frequency } = validation.data;
      const result = await answer_recurring_review_item_orchestrator(
        ctx,
        user_id,
        { item_id, answer, frequency: frequency ?? null },
        Date.now()
      );
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
      if (error instanceof HttpsError) throw error;
      if (error instanceof DomainError) {
        const message = error.code === "VALIDATION_ERROR" ? error.message : get_user_message(error.code);
        throw new HttpsError(get_https_error_code(error), message, { trace_id: ctx.trace_id, code: error.code });
      }
      throw new HttpsError("internal", "Failed to answer", { trace_id: ctx.trace_id });
    }
  }
);
