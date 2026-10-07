/**
 * Add To Group Entry Point (Account-Rooted-Sharing)
 *
 * Sends a join request to someone the caller is connected with.
 *
 * @module entry/callable/add_to_group
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
import { add_to_group_orchestrator, SharingWriteResult } from "../../orchestrators/sharing/groups.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  group_id: z.string().trim().min(1).max(128),
  invitee_id: z.string().trim().min(1).max(128),
  debug_mode: z.boolean().optional(),
});

/**
 * Sends a join request to someone the caller is connected with.
 */
export const add_to_group = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<SharingWriteResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "add_to_group");
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
      const result = await add_to_group_orchestrator({
        ...trace,
        input: { group_id: validation.data.group_id, invitee_id: validation.data.invitee_id },
        user_id,
        idempotency_key: `add_to_group:${trace.trace_id}`,
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
        "Unable to send the invite. Please try again.",
        trace.trace_id
      );
    }
  }
);
