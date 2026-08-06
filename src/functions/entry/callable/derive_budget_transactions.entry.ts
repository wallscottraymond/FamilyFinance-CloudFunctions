/**
 * Derive Budget Transactions Entry Point
 *
 * One callable: the transactions a budget owns FOR A PERIOD, resolved on read,
 * each tagged with a derived spend status (counted / ignored / refund) so the
 * budget-detail screen can show ignored items (incl. auto-ignored transfers) in a
 * dedicated section. Read-only; window hard-bounded.
 *
 * @module entry/callable/derive_budget_transactions
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
import { derive_budget_transactions_orchestrator } from "../../orchestrators/budgets/derive_budget_transactions.orchestrator";
import { success_response, FunctionResponse } from "../../types";

const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;

const schema = z
  .object({
    budget_id: z.string().min(1),
    window_start_ms: z.number().int().nonnegative(),
    window_end_ms: z.number().int().nonnegative(),
    debug_mode: z.boolean().optional(),
  })
  .refine((d) => d.window_end_ms >= d.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
  })
  .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range",
  });

export const derive_budget_transactions = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 100 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_budget_transactions");
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
      const rows = await derive_budget_transactions_orchestrator(
        ctx,
        user_id,
        input.budget_id,
        input.window_start_ms,
        input.window_end_ms
      );

      log_operation_success(span, user_id);
      return success_response(
        {
          budgetId: input.budget_id,
          transactions: rows.map((r) => ({
            transactionId: r.transaction_id,
            splitId: r.split_id,
            dateMs: r.date_ms,
            name: r.name,
            amount: r.amount,
            isPending: r.is_pending,
            spendStatus: r.spend_status,
            ignoredReason: r.ignored_reason,
          })),
        },
        ctx.trace_id
      );
    } catch (error) {
      log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
        user_id,
      });
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to derive budget transactions", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
