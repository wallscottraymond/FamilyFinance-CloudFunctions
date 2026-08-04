/**
 * Derive Budget View Entry Point
 *
 * Cloud Function entry for the Derive-On-Read Period Architecture (Phase 1):
 * compute a budget's weekly / bi-weekly VIEW for a bounded visible window from
 * the single materialized monthly home. Read-only; deletes/writes nothing.
 *
 * The window is HARD-BOUNDED here (the design's guardrail): a request may not
 * derive an unbounded range — only the visible window (± a little look-ahead).
 *
 * @module entry/callable/derive_budget_view
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
import { derive_budget_view_orchestrator } from "../../orchestrators/budgets/derive_budget_view.orchestrator";
import { success_response, FunctionResponse } from "../../types";
import { DerivedBudgetViewPeriod } from "../../domain/budgets/budget_view.service";

/** Hard cap on the derivable window (~6 months) — enforces "visible window only". */
const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;

const derive_budget_view_input_schema = z
  .object({
    budget_id: z.string().min(1, "budget_id is required"),
    view_cadence: z.enum(["weekly", "monthly", "bi_monthly"]),
    window_start_ms: z.number().int().nonnegative(),
    window_end_ms: z.number().int().nonnegative(),
    /** "stored" (interim, reads the assignment) | "on_read" (instant-budget match). */
    match_mode: z.enum(["stored", "on_read"]).optional(),
    debug_mode: z.boolean().optional(),
  })
  .refine((d) => d.window_end_ms >= d.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
  })
  .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range (visible window only)",
  });

/** A derived view period as returned to the client (camelCase DTO). */
interface DerivedViewPeriodResponse {
  budgetId: string;
  periodId: string;
  periodType: string;
  periodStart: number;
  periodEnd: number;
  allocatedAmount: number;
  effectiveAmount: number;
  spent: number;
  pendingSpent: number;
  returnAmount: number;
  remaining: number;
  isDerived: true;
}

interface DeriveBudgetViewResponseData {
  budgetId: string;
  budgetName: string;
  viewCadence: string;
  periods: DerivedViewPeriodResponse[];
}

function map_period_to_response(
  p: DerivedBudgetViewPeriod
): DerivedViewPeriodResponse {
  return {
    budgetId: p.budget_id,
    periodId: p.period_id,
    periodType: p.period_type,
    periodStart: p.start_ms,
    periodEnd: p.end_ms,
    allocatedAmount: p.allocated_amount,
    effectiveAmount: p.effective_amount,
    spent: p.spent,
    pendingSpent: p.pending_spent,
    returnAmount: p.return_amount,
    remaining: p.remaining,
    isDerived: true,
  };
}

/**
 * Derive a budget's non-monthly view for a bounded window.
 *
 * @returns The derived view periods, or throws not-found if the budget isn't
 *          owned by the caller.
 */
export const derive_budget_view = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 100 },
  async (
    request
  ): Promise<FunctionResponse<DeriveBudgetViewResponseData>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_budget_view");
    log_operation_start(span, user_id);

    try {
      const validation = derive_budget_view_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const input = validation.data;

      const result = await derive_budget_view_orchestrator(ctx, user_id, {
        budget_id: input.budget_id,
        view_cadence: input.view_cadence,
        window_start_ms: input.window_start_ms,
        window_end_ms: input.window_end_ms,
        match_mode: input.match_mode,
      });

      if (!result) {
        throw new HttpsError("not-found", "Budget not found", {
          trace_id: ctx.trace_id,
        });
      }

      const response_data: DeriveBudgetViewResponseData = {
        budgetId: result.budget_id,
        budgetName: result.budget_name,
        viewCadence: result.view_cadence,
        periods: result.periods.map(map_period_to_response),
      };

      log_operation_success(span, user_id);
      return success_response(response_data, ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError("internal", "Failed to derive budget view", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
