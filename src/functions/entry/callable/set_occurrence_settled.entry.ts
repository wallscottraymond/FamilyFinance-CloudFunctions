/**
 * Set Occurrence Settled Entry Point ("Mark as paid" / "Mark as received")
 *
 * Marks ONE occurrence of a recurring bill (`kind: "outflow"`) or income (`kind: "inflow"`)
 * settled by hand — paid in cash / Venmo / from an unlinked account, so no transaction will
 * arrive — or clears the mark (`settled: false`). A real payment that later settles the
 * occurrence wins over the mark (never double-counted). Delegates to the orchestrator.
 *
 * @module entry/callable/set_occurrence_settled
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
  set_occurrence_settled_orchestrator,
} from "../../orchestrators/recurring/set_occurrence_settled.orchestrator";
import {
  success_response,
  FunctionResponse,
  DomainError,
  get_https_error_code,
  get_user_message,
} from "../../types";

const schema = z.object({
  kind: z.enum(["outflow", "inflow"]),
  recurring_id: z.string().min(1, "recurring_id is required"),
  /** The occurrence's UTC due date. */
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "due_date must be YYYY-MM-DD"),
  settled: z.boolean(),
  /** Defaults (server-side) to the occurrence's expected amount. */
  amount: z.number().finite().nonnegative().optional(),
  debug_mode: z.boolean().optional(),
});

export const set_occurrence_settled = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 50 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "set_occurrence_settled");
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
      const { kind, recurring_id, due_date, settled, amount } = validation.data;

      // TODO(RBAC-Migration): fetch the user's group memberships so a shared item is
      // manageable by any member (same as manage_recurring_*). Owner-authorized until then.
      const user_group_ids: string[] = [];

      const result = await set_occurrence_settled_orchestrator(ctx, user_id, user_group_ids, {
        kind,
        recurring_id,
        due_date,
        settled,
        ...(amount !== undefined ? { amount } : {}),
      });

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
        // A validation failure carries its own reason (e.g. "not an occurrence of this item").
        const message =
          error.code === "VALIDATION_ERROR" ? error.message : get_user_message(error.code);
        throw new HttpsError(get_https_error_code(error), message, {
          trace_id: ctx.trace_id,
          code: error.code,
        });
      }
      throw new HttpsError("internal", "Failed to update the occurrence", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
