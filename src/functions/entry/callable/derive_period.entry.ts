/**
 * Derive Period Entry Point (batched)
 *
 * One callable that derives a whole period view — budgets, bills, income — for a
 * cadence + window, on read. Replaces ~N per-item calls with one round-trip.
 * Read-only; window hard-bounded.
 *
 * @module entry/callable/derive_period
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
  derive_period_orchestrator,
  DerivedBudgetResult,
  DerivedRecurringResult,
} from "../../orchestrators/periods/derive_period.orchestrator";
import { success_response, FunctionResponse } from "../../types";

const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;

const schema = z
  .object({
    view_cadence: z.enum(["weekly", "monthly", "bi_monthly"]),
    window_start_ms: z.number().int().nonnegative(),
    window_end_ms: z.number().int().nonnegative(),
    debug_mode: z.boolean().optional(),
  })
  .refine((d) => d.window_end_ms >= d.window_start_ms, { message: "window_end_ms must be >= window_start_ms" })
  .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range (visible window only)",
  });

function map_budget(b: DerivedBudgetResult) {
  return {
    budgetId: b.budget_id,
    name: b.name,
    isEverythingElse: b.is_everything_else,
    periods: b.periods.map((p) => ({
      periodId: p.period_id,
      periodType: p.period_type,
      allocatedAmount: p.allocated_amount,
      effectiveAmount: p.effective_amount,
      spent: p.spent,
      returnAmount: p.return_amount,
      remaining: p.remaining,
      isDerived: true,
    })),
  };
}
function map_recurring(r: DerivedRecurringResult) {
  return {
    recurringId: r.recurring_id,
    name: r.name,
    groups: r.groups.map((g) => ({
      periodId: g.period_id,
      countInPeriod: g.count_in_period,
      countPaid: g.count_paid,
      totalDue: g.total_due,
      totalPaid: g.total_paid,
      totalUnpaid: g.total_unpaid,
      isDuePeriod: g.is_due_period,
      isFullyPaid: g.is_fully_paid,
      status: g.status,
    })),
  };
}

export const derive_period = onCall(
  // Cold-start is absorbed client-side (stale-while-revalidate cache), so no
  // minInstances cost. maxInstances caps fan-out.
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 100 },
  async (request): Promise<FunctionResponse<unknown>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_period");
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
      const result = await derive_period_orchestrator(ctx, user_id, {
        view_cadence: input.view_cadence,
        window_start_ms: input.window_start_ms,
        window_end_ms: input.window_end_ms,
      });

      log_operation_success(span, user_id);
      return success_response(
        {
          viewCadence: result.view_cadence,
          budgets: result.budgets.map(map_budget),
          bills: result.bills.map(map_recurring),
          income: result.income.map(map_recurring),
        },
        ctx.trace_id
      );
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to derive period", { trace_id: ctx.trace_id });
    }
  }
);
