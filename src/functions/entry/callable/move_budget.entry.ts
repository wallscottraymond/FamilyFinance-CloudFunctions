/**
 * Move Budget Entry Point (Account-Rooted-Sharing)
 *
 * Moves a budget between Me and a group (D9): its settings and history come along.
 *
 * @module entry/callable/move_budget
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
  move_budget_orchestrator,
  BudgetViewResult,
} from "../../orchestrators/sharing/budget_view.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  budget_id: z.string().trim().min(1).max(128),
  /** null / absent = move to Me */
  to_group_id: z.string().trim().min(1).max(128).nullable().optional(),
  debug_mode: z.boolean().optional(),
});

/**
 * Moves a budget between Me and a group (D9): its settings and history come along.
 */
export const move_budget = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<BudgetViewResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "move_budget");
    log_operation_start(span, user_id);

    const validation = schema.safeParse(request.data || {});
    if (!validation.success) {
      log_operation_error(span, new Error("Validation failed"), {
        user_id,
        error_code: "VALIDATION_ERROR",
      });
      return error_response<BudgetViewResult>(
        "VALIDATION_ERROR",
        validation.error.issues.map((i: z.ZodIssue) => i.message).join("; "),
        trace.trace_id
      );
    }

    try {
      const result = await move_budget_orchestrator({
        ...trace,
        input: {
          budget_id: validation.data.budget_id,
          to_group_id: validation.data.to_group_id ?? null,
        },
        user_id,
        idempotency_key: `move_budget:${trace.trace_id}`,
      });
      if (!result.success) {
        return error_response<BudgetViewResult>(
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
      return error_response<BudgetViewResult>(
        "INTERNAL_ERROR",
        "Unable to move the budget. Please try again.",
        trace.trace_id
      );
    }
  }
);
