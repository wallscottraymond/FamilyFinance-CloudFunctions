/**
 * Share Account Entry Point (Account-Rooted-Sharing)
 *
 * The account owner shares an account with a group (members accept; a group of
 * one applies at once).
 *
 * @module entry/callable/share_account
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
  share_account_orchestrator,
  ShareAccountResult,
} from "../../orchestrators/sharing/placement.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

/** The local date → its UTC-midnight ms (how transaction dates are stored); only a date within
 *  ±2 days of now is accepted (else the server's own day is used). */
function share_from_ms(date?: string): number | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  return Math.abs(ms - Date.now()) <= 2 * 86_400_000 ? ms : null;
}

const schema = z.object({
  account_id: z.string().trim().min(1).max(128),
  group_id: z.string().trim().min(1).max(128),
  include_history: z.boolean().default(false),
  /** "From today on": the user's LOCAL date (YYYY-MM-DD) — share from the start of that day. */
  share_from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  debug_mode: z.boolean().optional(),
});

/**
 * The account owner shares an account with a group (members accept; a group of
 * one applies at once).
 */
export const share_account = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<ShareAccountResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "share_account");
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
      const result = await share_account_orchestrator({
        ...trace,
        input: {
          account_id: validation.data.account_id,
          group_id: validation.data.group_id,
          include_history: validation.data.include_history,
          share_from_ms: share_from_ms(validation.data.share_from_date),
        },
        user_id,
        idempotency_key: `share_account:${trace.trace_id}`,
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
        "Unable to share the account. Please try again.",
        trace.trace_id
      );
    }
  }
);
