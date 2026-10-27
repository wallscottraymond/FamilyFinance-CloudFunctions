/**
 * get_feedback_status — is the caller a Feedback Inbox owner, and (owner only) how many notes are
 * unread. A non-owner gets `is_owner: false` (never an error), which keeps the inbox row hidden.
 *
 * @module entry/callable/get_feedback_status
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { feedback_status_orchestrator } from "../../orchestrators/feedback/feedback.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";
import { FeedbackStatusResult } from "../../types/feedback.types";

export const get_feedback_status = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<FeedbackStatusResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "get_feedback_status");
    log_operation_start(span, user_id);

    try {
      const result = await feedback_status_orchestrator(trace, user_id);
      log_operation_success(span, user_id);
      return success_response(result, trace.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
        user_id,
        error_code: "INTERNAL_ERROR",
      });
      return error_response<FeedbackStatusResult>(
        "INTERNAL_ERROR",
        "Unable to load. Please try again.",
        trace.trace_id
      );
    }
  }
);
