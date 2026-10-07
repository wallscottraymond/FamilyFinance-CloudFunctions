/**
 * Get My Connect Code Entry Point (Account-Rooted-Sharing)
 *
 * Shows the caller's connect code (issues a new one when asked or when it has expired).
 *
 * @module entry/callable/get_my_connect_code
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
  get_my_connect_code_orchestrator,
  MyConnectCodeResult,
} from "../../orchestrators/sharing/connect.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  refresh: z.boolean().default(false),
  debug_mode: z.boolean().optional(),
});

/**
 * Shows the caller's connect code (issues a new one when asked or when it has expired).
 */
export const get_my_connect_code = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<MyConnectCodeResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "get_my_connect_code");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<MyConnectCodeResult>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const result = await get_my_connect_code_orchestrator({
        ...trace,
        input: { refresh: validation.data.refresh },
        user_id,
        idempotency_key: `get_my_connect_code:${trace.trace_id}`,
      });

      log_operation_success(span, user_id);
      return success_response(result, trace.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id, error_code: "INTERNAL_ERROR" }
      );
      return error_response<MyConnectCodeResult>(
        "INTERNAL_ERROR",
        "Unable to get your code. Please try again.",
        trace.trace_id
      );
    }
  }
);
