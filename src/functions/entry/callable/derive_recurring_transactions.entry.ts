/**
 * Derive Recurring Transactions Entry Point
 *
 * One callable: all transactions belonging to a recurring inflow/outflow stream,
 * each flagged in-period for the viewed window, so the bill/income detail screen
 * can render "This Period" + "Historical" sections. Read-only.
 *
 * @module entry/callable/derive_recurring_transactions
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
import { derive_recurring_transactions_orchestrator } from "../../orchestrators/recurring/derive_recurring_transactions.orchestrator";
import { success_response, FunctionResponse } from "../../types";

const schema = z.object({
  recurring_id: z.string().min(1),
  kind: z.enum(["outflow", "inflow"]),
  window_start_ms: z.number().int().nonnegative(),
  window_end_ms: z.number().int().nonnegative(),
  debug_mode: z.boolean().optional(),
});

export const derive_recurring_transactions = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 100 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_recurring_transactions");
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
      const input = validation.data;
      const rows = await derive_recurring_transactions_orchestrator(
        ctx,
        user_id,
        input.recurring_id,
        input.kind,
        input.window_start_ms,
        input.window_end_ms
      );

      log_operation_success(span, user_id);
      return success_response(
        {
          recurringId: input.recurring_id,
          kind: input.kind,
          transactions: rows.map((r) => ({
            transactionId: r.transaction_id,
            dateMs: r.date_ms,
            name: r.name,
            amount: r.amount,
            isPending: r.is_pending,
            inPeriod: r.in_period,
          })),
        },
        ctx.trace_id
      );
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
        user_id,
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to derive recurring transactions", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
