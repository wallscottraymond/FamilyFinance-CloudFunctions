/**
 * Enter Connect Code Entry Point (Account-Rooted-Sharing)
 *
 * The caller typed someone's code. Connects when both people have typed each other's code.
 *
 * @module entry/callable/enter_connect_code
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
  enter_connect_code_orchestrator,
  EnterConnectCodeResult,
} from "../../orchestrators/sharing/connect.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  code: z.string().min(1).max(20),
  debug_mode: z.boolean().optional(),
});

/**
 * The caller typed someone's code. Connects when both people have typed each other's code.
 */
export const enter_connect_code = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<EnterConnectCodeResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "enter_connect_code");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<EnterConnectCodeResult>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const result = await enter_connect_code_orchestrator({
        ...trace,
        input: { code: validation.data.code },
        user_id,
        idempotency_key: `enter_connect_code:${trace.trace_id}`,
      });

      log_operation_success(span, user_id);
      return success_response(result, trace.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id, error_code: "INTERNAL_ERROR" }
      );
      return error_response<EnterConnectCodeResult>(
        "INTERNAL_ERROR",
        "Unable to check that code. Please try again.",
        trace.trace_id
      );
    }
  }
);
