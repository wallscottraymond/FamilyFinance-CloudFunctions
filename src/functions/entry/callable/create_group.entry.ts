/**
 * Create Group Entry Point (Account-Rooted-Sharing)
 *
 * Creates a group (the caller owns it) and sends join requests to connected people.
 *
 * @module entry/callable/create_group
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
import { create_group_orchestrator, SharingWriteResult } from "../../orchestrators/sharing/groups.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  name: z.string().max(200),
  invitee_ids: z.array(z.string().trim().min(1).max(128)).max(10).default([]),
  debug_mode: z.boolean().optional(),
});

/**
 * Creates a group (the caller owns it) and sends join requests to connected people.
 */
export const create_group = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<SharingWriteResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "create_group");
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
      const result = await create_group_orchestrator({
        ...trace,
        input: { name: validation.data.name, invitee_ids: validation.data.invitee_ids },
        user_id,
        idempotency_key: `create_group:${trace.trace_id}`,
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
        "Unable to create the group. Please try again.",
        trace.trace_id
      );
    }
  }
);
