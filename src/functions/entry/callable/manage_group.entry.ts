/**
 * Manage Group Entry Point (Account-Rooted-Sharing)
 *
 * Rename, remove a member, hand over ownership, leave or delete a group.
 *
 * @module entry/callable/manage_group
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
  manage_group_orchestrator,
  SharingWriteResult,
} from "../../orchestrators/sharing/groups.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    group_id: z.string().trim().min(1).max(128),
    name: z.string().max(200),
  }),
  z.object({
    action: z.literal("remove_member"),
    group_id: z.string().trim().min(1).max(128),
    user_id: z.string().trim().min(1).max(128),
  }),
  z.object({
    action: z.literal("transfer_ownership"),
    group_id: z.string().trim().min(1).max(128),
    user_id: z.string().trim().min(1).max(128),
  }),
  z.object({ action: z.literal("leave"), group_id: z.string().trim().min(1).max(128) }),
  z.object({ action: z.literal("delete"), group_id: z.string().trim().min(1).max(128) }),
]);

/**
 * Rename, remove a member, hand over ownership, leave or delete a group.
 */
export const manage_group = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<SharingWriteResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "manage_group");
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
      const result = await manage_group_orchestrator({
        ...trace,
        input: validation.data,
        user_id,
        idempotency_key: `manage_group:${trace.trace_id}`,
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
        "Unable to update the group. Please try again.",
        trace.trace_id
      );
    }
  }
);
