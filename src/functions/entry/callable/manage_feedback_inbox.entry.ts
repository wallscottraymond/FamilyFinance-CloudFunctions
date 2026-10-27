/**
 * manage_feedback_inbox — the owner-only Feedback Inbox (D10): list (by status, optional type),
 * mark read, open / done, delete. Anyone else gets PERMISSION_DENIED.
 *
 * @module entry/callable/manage_feedback_inbox
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
import { feedback_inbox_orchestrator } from "../../orchestrators/feedback/feedback.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";
import { feedback_inbox_input_schema, FeedbackInboxResult } from "../../types/feedback.types";

export const manage_feedback_inbox = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 10 },
  async (request): Promise<FunctionResponse<FeedbackInboxResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "manage_feedback_inbox");
    log_operation_start(span, user_id);

    const validation = feedback_inbox_input_schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<FeedbackInboxResult>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const outcome = await feedback_inbox_orchestrator({
        ...trace,
        input: validation.data,
        user_id,
        idempotency_key: `manage_feedback_inbox:${trace.trace_id}`,
      });
      if (!outcome.success) {
        log_operation_error(span, new Error(outcome.code), { user_id, error_code: outcome.code });
        return error_response<FeedbackInboxResult>(outcome.code, outcome.message, trace.trace_id);
      }
      log_operation_success(span, user_id);
      return success_response(outcome.data, trace.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
        user_id,
        error_code: "INTERNAL_ERROR",
      });
      return error_response<FeedbackInboxResult>(
        "INTERNAL_ERROR",
        "Unable to update. Please try again.",
        trace.trace_id
      );
    }
  }
);
