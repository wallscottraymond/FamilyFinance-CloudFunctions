/**
 * Unshare Account Entry Point (Account-Rooted-Sharing)
 *
 * The account owner makes a shared account private again (cancels a pending
 * share too).
 *
 * @module entry/callable/unshare_account
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
  unshare_account_orchestrator,
  ShareAccountResult,
} from "../../orchestrators/sharing/placement.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  account_id: z.string().trim().min(1).max(128),
  debug_mode: z.boolean().optional(),
});

/**
 * The account owner makes a shared account private again (cancels a pending
 * share too).
 */
export const unshare_account = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<ShareAccountResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "unshare_account");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<ShareAccountResult>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const result = await unshare_account_orchestrator({
        ...trace,
        input: { account_id: validation.data.account_id },
        user_id,
        idempotency_key: `unshare_account:${trace.trace_id}`,
      });
      if (!result.success) {
        return error_response<ShareAccountResult>(
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
      return error_response<ShareAccountResult>(
        "INTERNAL_ERROR",
        "Unable to change sharing. Please try again.",
        trace.trace_id
      );
    }
  }
);
