/**
 * Respond To Request Entry Point (Account-Rooted-Sharing)
 *
 * Accepts or declines a request addressed to the caller.
 *
 * @module entry/callable/respond_to_request
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
import { respond_to_request_orchestrator, SharingWriteResult } from "../../orchestrators/sharing/groups.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  request_id: z.string().trim().min(1).max(128),
  accept: z.boolean(),
  debug_mode: z.boolean().optional(),
});

/**
 * Accepts or declines a request addressed to the caller.
 */
export const respond_to_request = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<SharingWriteResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "respond_to_request");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<SharingWriteResult>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const result = await respond_to_request_orchestrator({
        ...trace,
        input: { request_id: validation.data.request_id, accept: validation.data.accept },
        user_id,
        idempotency_key: `respond_to_request:${trace.trace_id}`,
      });
      if (!result.success) {
        return error_response<SharingWriteResult>(
          "VALIDATION_ERROR",
          (result.errors ?? ["Not allowed"]).join("; "),
          trace.trace_id
        );
      }
      log_operation_success(span, user_id);
      return success_response(result, trace.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id, error_code: "INTERNAL_ERROR" }
      );
      return error_response<SharingWriteResult>(
        "INTERNAL_ERROR",
        "Unable to answer the request. Please try again.",
        trace.trace_id
      );
    }
  }
);
