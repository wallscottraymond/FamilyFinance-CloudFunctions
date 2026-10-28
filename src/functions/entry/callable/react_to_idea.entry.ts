/**
 * React To Idea Entry Point (Planning-Module v1, Ideas). Like / unlike, comment (client-made
 * comment id dedupes retries), or delete your own comment.
 *
 * @module entry/callable/react_to_idea
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
import { react_to_idea_orchestrator } from "../../orchestrators/ideas/idea.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";
import { react_to_idea_input_schema, ReactToIdeaResult } from "../../types/ideas.types";

export const react_to_idea = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<ReactToIdeaResult>> => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    const user_id = request.auth.uid;
    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "react_to_idea");
    log_operation_start(span, user_id);

    const validation = react_to_idea_input_schema.safeParse(request.data || {});
    if (!validation.success) {
      const message = validation.error.issues.map((i: z.ZodIssue) => i.message).join("; ");
      log_operation_error(span, new Error(message), { user_id });
      return error_response("VALIDATION_ERROR", message, trace.trace_id);
    }

    try {
      const outcome = await react_to_idea_orchestrator({
        ...trace,
        input: validation.data,
        user_id,
        idempotency_key: `react_to_idea:${trace.trace_id}`,
      });
      if (!outcome.success) return error_response(outcome.code, outcome.message, trace.trace_id);
      log_operation_success(span, user_id);
      return success_response(outcome.data, trace.trace_id);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      log_operation_error(span, err, { user_id });
      const msg = "Couldn't save that. Please try again.";
      return error_response("INTERNAL_ERROR", msg, trace.trace_id);
    }
  }
);
