/**
 * list_my_feedback — the caller's own sent notes, newest first (the Sent tab).
 *
 * @module entry/callable/list_my_feedback
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { list_my_feedback_orchestrator } from "../../orchestrators/feedback/feedback.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";
import { ListMyFeedbackResult } from "../../types/feedback.types";

export const list_my_feedback = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<ListMyFeedbackResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "list_my_feedback");
    log_operation_start(span, user_id);

    try {
      const result = await list_my_feedback_orchestrator(trace, user_id);
      log_operation_success(span, user_id);
      return success_response(result, trace.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
        user_id,
        error_code: "INTERNAL_ERROR",
      });
      return error_response<ListMyFeedbackResult>(
        "INTERNAL_ERROR",
        "Unable to load. Please try again.",
        trace.trace_id
      );
    }
  }
);
