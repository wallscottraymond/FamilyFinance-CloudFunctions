/**
 * Delete Budget Entry Point
 *
 * onCall entry for deleting a budget. Replaces the legacy onRequest HTTP
 * deleteBudget function.
 *
 * @module entry/callable/delete_budget
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
import { delete_budget_orchestrator } from "../../orchestrators/budgets";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";
import {
  delete_budget_input_schema,
  DeleteBudgetResponse,
} from "../../types/budgets/delete_budget.types";

/**
 * Delete a budget.
 */
export const delete_budget = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<DeleteBudgetResponse>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "delete_budget");
    log_operation_start(span, user_id);

    try {
      const validation = delete_budget_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const data = validation.data;

      const result = await delete_budget_orchestrator(
        ctx,
        user_id,
        data.idempotency_key,
        data.budget_id
      );

      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );
      if (error instanceof HttpsError) {
        throw error;
      }
      if (error instanceof DomainError) {
        throw new HttpsError(
          get_https_error_code(error),
          get_user_message(error.code),
          { trace_id: ctx.trace_id, code: error.code }
        );
      }
      if (
        error instanceof Error &&
        error.message === "Request already in progress"
      ) {
        throw new HttpsError(
          "aborted",
          "This action is already in progress. Please wait.",
          { trace_id: ctx.trace_id }
        );
      }
      throw new HttpsError("internal", "Failed to delete budget", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
