/**
 * Update Goal Entry Point — Goals (Phase 1)
 *
 * @module entry/callable/update_goal
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { update_goal_orchestrator } from "../../orchestrators/goals";
import { success_response, FunctionResponse } from "../../types";
import {
  update_goal_input_schema,
  UpdateGoalInput,
  UpdateGoalResponse,
} from "../../types/goals/goal_crud.types";
import { handle_goal_entry_error } from "./create_goal.entry";

export const update_goal = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<UpdateGoalResponse>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "update_goal");
    log_operation_start(span, user_id);

    try {
      const validation = update_goal_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const data = validation.data;

      const input: UpdateGoalInput = {
        goal_id: data.goal_id,
        name: data.name,
        target_amount: data.target_amount,
        end_date: data.end_date,
        home_cadence: data.home_cadence,
        per_period_amount: data.per_period_amount,
        priority_rank: data.priority_rank,
        status: data.status,
        linked_recurring_id: data.linked_recurring_id,
        apr: data.apr,
        minimum_payment: data.minimum_payment,
        extra_principal: data.extra_principal,
      };

      const result = await update_goal_orchestrator(
        ctx,
        user_id,
        data.idempotency_key,
        input
      );

      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      return handle_goal_entry_error(error, ctx, span, user_id, "update goal");
    }
  }
);
