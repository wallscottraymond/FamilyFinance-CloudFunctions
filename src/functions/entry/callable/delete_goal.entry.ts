/**
 * Delete Goal Entry Point — Goals (Phase 1)
 *
 * @module entry/callable/delete_goal
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { delete_goal_orchestrator } from "../../orchestrators/goals";
import { success_response, FunctionResponse } from "../../types";
import {
  delete_goal_input_schema,
  DeleteGoalResponse,
} from "../../types/goals/goal_crud.types";
import { handle_goal_entry_error } from "./create_goal.entry";

export const delete_goal = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<DeleteGoalResponse>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "delete_goal");
    log_operation_start(span, user_id);

    try {
      const validation = delete_goal_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const data = validation.data;

      const result = await delete_goal_orchestrator(
        ctx,
        user_id,
        data.idempotency_key,
        data.goal_id
      );

      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      return handle_goal_entry_error(error, ctx, span, user_id, "delete goal");
    }
  }
);
