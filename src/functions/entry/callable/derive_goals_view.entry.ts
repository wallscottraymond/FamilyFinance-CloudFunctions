/**
 * Derive Goals View Entry Point — Goals (Phase 1)
 *
 * onCall read endpoint for the period-page Goals section: given a period_id,
 * returns each active goal + its measured progress for that period. Read-only.
 *
 * @module entry/callable/derive_goals_view
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import {
  derive_goals_view_orchestrator,
  DeriveGoalsViewResult,
} from "../../orchestrators/goals";
import { success_response, FunctionResponse } from "../../types";
import { handle_goal_entry_error } from "./create_goal.entry";

const derive_goals_view_input_schema = z.object({
  period_id: z.string().min(1, "period_id is required"),
  debug_mode: z.boolean().optional(),
});

export const derive_goals_view = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<DeriveGoalsViewResult>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_goals_view");
    log_operation_start(span, user_id);

    try {
      const validation = derive_goals_view_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }

      const result = await derive_goals_view_orchestrator(
        ctx,
        user_id,
        validation.data.period_id
      );

      log_operation_success(span, user_id);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      return handle_goal_entry_error(error, ctx, span, user_id, "load goals");
    }
  }
);
