/**
 * Update Budget Entry Point
 *
 * onCall entry for updating a budget. Replaces the legacy onRequest HTTP
 * updateBudget function.
 *
 * @module entry/callable/update_budget
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
import { update_budget_orchestrator } from "../../orchestrators/budgets";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";
import {
  update_budget_input_schema,
  UpdateBudgetInput,
  UpdateBudgetResponse,
} from "../../types/budgets/update_budget.types";

/**
 * Update a budget.
 */
export const update_budget = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<UpdateBudgetResponse>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "update_budget");
    log_operation_start(span, user_id);

    try {
      const validation = update_budget_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const data = validation.data;

      const input: UpdateBudgetInput = {
        budget_id: data.budget_id,
        name: data.name,
        description: data.description,
        amount: data.amount,
        category_ids: data.category_ids,
        alert_threshold: data.alert_threshold,
        is_ongoing: data.is_ongoing,
        budget_end_date: data.budget_end_date,
        rollover_enabled: data.rollover_enabled,
        rollover_strategy: data.rollover_strategy,
        rollover_spread_periods: data.rollover_spread_periods,
      };

      const result = await update_budget_orchestrator(
        ctx,
        user_id,
        data.idempotency_key,
        input
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
      throw new HttpsError("internal", "Failed to update budget", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
