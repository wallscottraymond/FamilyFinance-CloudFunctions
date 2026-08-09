/**
 * Manage Recurring Outflow Entry Point
 *
 * One callable for the Remove-Recover-Recurring actions on a recurring bill:
 * `remove` (all / going_forward), `pause` (until a date), `restore` (forward-only
 * resume), and `delete` (permanent). Delegates to the generic manage orchestrator
 * with the outflow repo.
 *
 * @module entry/callable/manage_recurring_outflow
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
import { outflow_repo } from "../../repositories/outflow.repo";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

const schema = z.intersection(
  z.object({
    outflow_id: z.string().min(1, "outflow_id is required"),
    debug_mode: z.boolean().optional(),
  }),
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("remove"), mode: z.enum(["all", "going_forward"]) }),
    z.object({ action: z.literal("pause"), resume_ms: z.number().int().positive() }),
    z.object({ action: z.literal("restore") }),
    z.object({ action: z.literal("delete") }),
  ])
);

export const manage_recurring_outflow = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "manage_recurring_outflow");
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

      // Build the discriminated orchestrator input (generic `id`).
      let input: ManageRecurringRemovalInput;
      if (data.action === "remove") {
        input = { id: data.outflow_id, action: "remove", mode: data.mode };
      } else if (data.action === "pause") {
        input = { id: data.outflow_id, action: "pause", resume_ms: data.resume_ms };
      } else if (data.action === "restore") {
        input = { id: data.outflow_id, action: "restore" };
      } else {
        input = { id: data.outflow_id, action: "delete" };
      }

      // TODO(RBAC-Migration): fetch the user's group memberships so a shared item
      // is manageable by any member. Owner-authorized until then.
      const user_group_ids: string[] = [];
      const now_ms = Date.now();

      const result = await manage_recurring_removal_orchestrator(
        ctx,
        user_id,
        user_group_ids,
        input,
        now_ms,
        outflow_repo,
        "recurring_outflow"
      );

      log_operation_success(span, user_id);
      return success_response(
        {
          /* eslint-disable @typescript-eslint/naming-convention */
          outflow_id: result.id,
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
      throw new HttpsError("internal", "Failed to manage recurring outflow", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
