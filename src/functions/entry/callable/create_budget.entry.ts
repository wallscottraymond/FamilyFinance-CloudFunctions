/**
 * Create Budget Entry Point
 *
 * onCall entry for creating a budget in the layered architecture.
 *
 * @module entry/callable/create_budget
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
import { create_budget_orchestrator } from "../../orchestrators/budgets";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";
import {
  create_budget_input_schema,
  CreateBudgetInput,
  CreateBudgetResponse,
} from "../../types/budgets/create_budget.types";

/**
 * Create a budget.
 */
export const create_budget = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<CreateBudgetResponse>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "create_budget");
    log_operation_start(span, user_id);

    try {
      const validation = create_budget_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const data = validation.data;

      // Normalize wire payload → internal input (apply defaults)
      const input: CreateBudgetInput = {
        name: data.name,
        description: data.description,
        amount: data.amount,
        category_ids: data.category_ids,
        period: data.period,
        budget_type: data.budget_type ?? "recurring",
        start_date: data.start_date,
        end_date: data.end_date,
        alert_threshold: data.alert_threshold ?? 80,
        is_shared: data.is_shared ?? false,
        group_id: data.group_id,
        selected_start_period: data.selected_start_period,
        is_ongoing: data.is_ongoing ?? true,
        budget_end_date: data.budget_end_date,
      };

      const result = await create_budget_orchestrator(
        ctx,
        user_id,
        data.idempotency_key,
        input
      );

      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      return handle_entry_error(error, ctx, span, user_id);
    }
  }
);

/**
 * Maps thrown errors to HttpsError. Shared shape across budget entries.
 */
function handle_entry_error(
  error: unknown,
  ctx: { trace_id: string },
  span: Parameters<typeof log_operation_error>[0],
  user_id: string
): never {
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
  throw new HttpsError("internal", "Failed to create budget", {
    trace_id: ctx.trace_id,
  });
}
