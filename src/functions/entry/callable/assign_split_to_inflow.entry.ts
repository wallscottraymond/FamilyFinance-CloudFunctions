/**
 * Assign Split → Income Entry Point (Convert-To-Recurring Phase 2)
 *
 * Manually pin a deposit's split to one of the caller's recurring incomes, or clear the pin
 * (`inflow_id: null`). The pin is durable (`inflowAssignmentSource: "manual"`): the assignment
 * engine preserves it across Plaid re-syncs and it beats Plaid stream membership. Owner only;
 * only money coming in; only an income in the transaction's own view. Flag-gated.
 *
 * @module entry/callable/assign_split_to_inflow
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
import { assign_split_to_inflow_orchestrator } from "../../orchestrators/recurring/assign_split_to_inflow.orchestrator";
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
  split_id: z.string().min(1).max(128).regex(/^[^/]+$/, "split_id is invalid"),
  /** The income to pin to; null clears the pin. */
  inflow_id: z.string().regex(ID, "inflow_id is invalid").nullable(),
  debug_mode: z.boolean().optional(),
});

export const assign_split_to_inflow = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "assign_split_to_inflow");
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
      const { transaction_id, split_id, inflow_id } = validation.data;
      const result = await assign_split_to_inflow_orchestrator(ctx, user_id, { transaction_id, split_id, inflow_id });
      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), { user_id });
      if (error instanceof HttpsError) throw error;
      if (error instanceof ConvertRefusedError) {
        throw new HttpsError("failed-precondition", error.message, { trace_id: ctx.trace_id, code: error.code, ...(error.details ?? {}) });
      }
      if (error instanceof DomainError) {
        throw new HttpsError(get_https_error_code(error), get_user_message(error.code), { trace_id: ctx.trace_id });
      }
      throw new HttpsError("internal", "Failed to assign the deposit to an income", { trace_id: ctx.trace_id });
    }
  }
);
