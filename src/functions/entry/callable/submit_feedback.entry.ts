/**
 * submit_feedback — send a Feedback or Questions note.
 *
 * The note never stores who sent it (D2/D7); the client-made `note_id` dedupes a retried send;
 * 20 notes per UTC day (D8).
 *
 * @module entry/callable/submit_feedback
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
import { submit_feedback_orchestrator } from "../../orchestrators/feedback/feedback.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";
import { submit_feedback_input_schema, SubmitFeedbackResult } from "../../types/feedback.types";

export const submit_feedback = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<SubmitFeedbackResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "submit_feedback");
    log_operation_start(span, user_id);

    const validation = submit_feedback_input_schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<SubmitFeedbackResult>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const outcome = await submit_feedback_orchestrator({
        ...trace,
        input: validation.data,
        user_id,
        idempotency_key: `submit_feedback:${validation.data.note_id}`,
      });
      if (!outcome.success) {
        log_operation_error(span, new Error(outcome.code), { user_id, error_code: outcome.code });
        return error_response<SubmitFeedbackResult>(outcome.code, outcome.message, trace.trace_id);
      }
      log_operation_success(span, user_id);
      return success_response(outcome.data, trace.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
        user_id,
        error_code: "INTERNAL_ERROR",
      });
      return error_response<SubmitFeedbackResult>(
        "INTERNAL_ERROR",
        "Couldn't send. Please try again.",
        trace.trace_id
      );
    }
  }
);
