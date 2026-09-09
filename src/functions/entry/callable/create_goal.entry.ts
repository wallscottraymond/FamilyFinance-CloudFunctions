/**
 * Create Goal Entry Point — Goals (Phase 1)
 *
 * onCall entry for creating a goal in the layered architecture.
 *
 * @module entry/callable/create_goal
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
import { create_goal_orchestrator } from "../../orchestrators/goals";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";
import {
  create_goal_input_schema,
  CreateGoalInput,
  CreateGoalResponse,
} from "../../types/goals/goal_crud.types";

export const create_goal = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<CreateGoalResponse>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "create_goal");
    log_operation_start(span, user_id);

    try {
      const validation = create_goal_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const data = validation.data;

      const input: CreateGoalInput = {
        goal_type: data.goal_type,
        name: data.name,
        linked_account_id: data.linked_account_id,
        target_amount: data.target_amount ?? null,
        end_date: data.end_date ?? null,
        home_cadence: data.home_cadence,
        per_period_amount: data.per_period_amount,
        baseline_counts_existing: data.baseline_counts_existing ?? false,
        is_shared: data.is_shared ?? false,
        group_id: data.group_id,
        linked_recurring_id: data.linked_recurring_id ?? null,
        apr: data.apr ?? null,
        minimum_payment: data.minimum_payment ?? null,
        extra_principal: data.extra_principal ?? null,
      };

      const result = await create_goal_orchestrator(
        ctx,
        user_id,
        data.idempotency_key,
        input
      );

      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      return handle_goal_entry_error(error, ctx, span, user_id, "create goal");
    }
  }
);

/** Maps thrown errors to HttpsError. Shared across goal entries. */
export function handle_goal_entry_error(
  error: unknown,
  ctx: { trace_id: string },
  span: Parameters<typeof log_operation_error>[0],
  user_id: string,
  action: string
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
  if (error instanceof Error && error.message === "Request already in progress") {
    throw new HttpsError(
      "aborted",
      "This action is already in progress. Please wait.",
      { trace_id: ctx.trace_id }
    );
  }
  throw new HttpsError("internal", `Failed to ${action}`, {
    trace_id: ctx.trace_id,
  });
}
