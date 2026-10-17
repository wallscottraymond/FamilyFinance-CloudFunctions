/**
 * Convert Transaction To Recurring Entry Point (Convert-To-Recurring Phase 2)
 *
 * "Make this a bill / income" from a transaction (or one split). Owner only (D24); flag-gated.
 * Returns the new record's id; a refusal comes back as `failed-precondition` with a `code` the sheet
 * shows (ALREADY_TRACKED carries the bill's id + name).
 *
 * @module entry/callable/convert_transaction_to_recurring
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
import { convert_transaction_to_recurring_orchestrator } from "../../orchestrators/recurring/convert_transaction_to_recurring.orchestrator";
import { CONVERT_FREQUENCIES, CONVERT_AMOUNT_MAX, CONVERT_NAME_MAX } from "../../domain/recurring/convert_recurring.service";
import {
  success_response,
  FunctionResponse,
  ConvertRefusedError,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const schema = z.object({
  transaction_id: z.string().regex(ID, "transaction_id is invalid"),
  split_id: z.string().min(1).max(128).regex(/^[^/]+$/, "split_id is invalid").optional(),
  name: z.string().trim().min(1, "A name is required").max(CONVERT_NAME_MAX),
  amount: z.number().positive("The amount must be greater than zero").max(CONVERT_AMOUNT_MAX),
  frequency: z.enum(CONVERT_FREQUENCIES),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date"),
  link_past: z.boolean().default(true),
  review_item_id: z.string().regex(ID, "review_item_id is invalid").optional(),
  debug_mode: z.boolean().optional(),
});

export const convert_transaction_to_recurring = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20, timeoutSeconds: 300, memory: "512MiB" },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "convert_transaction_to_recurring");
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
      const { debug_mode: _debug, ...input } = validation.data;
      void _debug;
      const result = await convert_transaction_to_recurring_orchestrator(ctx, user_id, input, Date.now());
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
      if (error instanceof HttpsError) throw error;
      if (error instanceof ConvertRefusedError) {
        throw new HttpsError("failed-precondition", error.message, { trace_id: ctx.trace_id, code: error.code, ...(error.details ?? {}) });
      }
      if (error instanceof DomainError) {
        const message = error.code === "VALIDATION_ERROR" ? error.message : get_user_message(error.code);
        throw new HttpsError(get_https_error_code(error), message, { trace_id: ctx.trace_id, code: error.code });
      }
      throw new HttpsError("internal", "Failed to make this a bill", { trace_id: ctx.trace_id });
    }
  }
);
