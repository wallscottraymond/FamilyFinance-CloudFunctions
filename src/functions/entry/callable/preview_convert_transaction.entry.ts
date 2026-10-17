/**
 * Preview Convert Transaction Entry Point (Convert-To-Recurring Phase 2): read-only suggestions for
 * the "Make this a bill" sheet (name, amount, schedule guess, how many past payments would link).
 * Owner only; flag-gated (`{enabled: false}` when off).
 *
 * @module entry/callable/preview_convert_transaction
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
import { preview_convert_transaction_orchestrator } from "../../orchestrators/recurring/preview_convert_transaction.orchestrator";
import {
  success_response,
  FunctionResponse,
  ConvertRefusedError,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

const schema = z.object({
  transaction_id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "transaction_id is invalid"),
  debug_mode: z.boolean().optional(),
});

export const preview_convert_transaction = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "preview_convert_transaction");
    log_operation_start(span, user_id);
    try {
      const validation = schema.safeParse(request.data);
      if (!validation.success) {
        throw new HttpsError(
          "invalid-argument",
          validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
          { trace_id: ctx.trace_id }
        );
      }
      const result = await preview_convert_transaction_orchestrator(
        ctx, user_id, { transaction_id: validation.data.transaction_id }, Date.now()
      );
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
      if (error instanceof HttpsError) throw error;
      if (error instanceof ConvertRefusedError) {
        throw new HttpsError("failed-precondition", error.message, { trace_id: ctx.trace_id, code: error.code });
      }
      if (error instanceof DomainError) {
        throw new HttpsError(get_https_error_code(error), get_user_message(error.code), { trace_id: ctx.trace_id });
      }
      throw new HttpsError("internal", "Failed to preview", { trace_id: ctx.trace_id });
    }
  }
);
