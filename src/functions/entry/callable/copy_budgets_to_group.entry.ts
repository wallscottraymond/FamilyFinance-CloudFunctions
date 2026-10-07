/**
 * Copy Budgets To Group Entry Point (Account-Rooted-Sharing)
 *
 * Copies the caller's budgets into a group (D32); clashes come back as
 * conflicts.
 *
 * @module entry/callable/copy_budgets_to_group
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
  copy_budgets_to_group_orchestrator,
  BudgetViewResult,
} from "../../orchestrators/sharing/budget_view.orchestrator";
import { success_response, error_response, FunctionResponse } from "../../types";

const schema = z.object({
  group_id: z.string().trim().min(1).max(128),
  items: z
    .array(
      z.object({
        budget_id: z.string().trim().min(1).max(128),
        amount: z.number().positive(),
      })
    )
    .min(1)
    .max(50),
  remove_from_me: z.boolean().default(false),
  debug_mode: z.boolean().optional(),
});

/**
 * Copies the caller's budgets into a group (D32); clashes come back as
 * conflicts.
 */
export const copy_budgets_to_group = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 20 },
  async (request): Promise<FunctionResponse<BudgetViewResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const trace = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(trace, "entry", "copy_budgets_to_group");
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
      const result = await copy_budgets_to_group_orchestrator({
        ...trace,
        input: {
          group_id: validation.data.group_id,
          items: validation.data.items,
          remove_from_me: validation.data.remove_from_me,
        },
        user_id,
        idempotency_key: `copy_budgets_to_group:${trace.trace_id}`,
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
        "Unable to copy the budgets. Please try again.",
        trace.trace_id
      );
    }
  }
);
