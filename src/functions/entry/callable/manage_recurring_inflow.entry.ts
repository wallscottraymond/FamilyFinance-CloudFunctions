/**
 * Manage Recurring Inflow Entry Point
 *
 * One callable for the Remove-Recover-Recurring actions on a recurring income:
 * `remove` (all / going_forward), `pause` (until a date), `restore` (forward-only
 * resume), and `delete` (permanent). Delegates to the generic manage orchestrator
 * with the inflow repo.
 *
 * @module entry/callable/manage_recurring_inflow
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
  manage_recurring_removal_orchestrator,
  ManageRecurringRemovalInput,
} from "../../orchestrators/recurring/manage_recurring_removal.orchestrator";
import { inflow_repo } from "../../repositories/inflow.repo";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

const schema = z.intersection(
  z.object({
    inflow_id: z.string().min(1, "inflow_id is required"),
    debug_mode: z.boolean().optional(),
  }),
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("remove"), mode: z.enum(["all", "going_forward"]) }),
    z.object({ action: z.literal("pause"), resume_ms: z.number().int().positive() }),
    z.object({ action: z.literal("restore") }),
    z.object({ action: z.literal("delete") }),
  ])
);

export const manage_recurring_inflow = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "manage_recurring_inflow");
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
      const data = validation.data;

      let input: ManageRecurringRemovalInput;
      if (data.action === "remove") {
        input = { id: data.inflow_id, action: "remove", mode: data.mode };
      } else if (data.action === "pause") {
        input = { id: data.inflow_id, action: "pause", resume_ms: data.resume_ms };
      } else if (data.action === "restore") {
        input = { id: data.inflow_id, action: "restore" };
      } else {
        input = { id: data.inflow_id, action: "delete" };
      }

      // TODO(RBAC-Migration): fetch the user's group memberships.
      const user_group_ids: string[] = [];
      const now_ms = Date.now();

      const result = await manage_recurring_removal_orchestrator(
        ctx,
        user_id,
        user_group_ids,
        input,
        now_ms,
        inflow_repo,
        "recurring_inflow"
      );

      log_operation_success(span, user_id);
      return success_response(
        {
          /* eslint-disable @typescript-eslint/naming-convention */
          inflow_id: result.id,
          action: result.action,
          deleted: result.deleted,
          state: result.state,
          /* eslint-enable @typescript-eslint/naming-convention */
        },
        ctx.trace_id
      );
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
      throw new HttpsError("internal", "Failed to manage recurring inflow", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
