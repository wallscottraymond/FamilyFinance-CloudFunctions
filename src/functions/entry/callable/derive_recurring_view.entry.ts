/**
 * Derive Recurring View Entry Point
 *
 * Cloud Function entry for the Derive-On-Read Period Architecture (Phase 3):
 * compute a bill/income (recurring outflow) view for a bounded visible window,
 * fresh from the item's schedule + actual payments. Read-only; writes nothing.
 *
 * The window is HARD-BOUNDED here (design guardrail): only the visible window.
 *
 * @module entry/callable/derive_recurring_view
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
import { derive_recurring_view_orchestrator } from "../../orchestrators/recurring/derive_recurring_view.orchestrator";
import { success_response, FunctionResponse } from "../../types";
import { PlacedOccurrenceGroup } from "../../domain/recurring/occurrence_placement.service";

/** Hard cap on the derivable window (~6 months). */
const MAX_WINDOW_MS = 200 * 24 * 60 * 60 * 1000;

const derive_recurring_view_input_schema = z
  .object({
    kind: z.enum(["outflow", "inflow"]),
    recurring_id: z.string().min(1, "recurring_id is required"),
    view_cadence: z.enum(["weekly", "monthly", "bi_monthly"]),
    window_start_ms: z.number().int().nonnegative(),
    window_end_ms: z.number().int().nonnegative(),
    debug_mode: z.boolean().optional(),
  })
  .refine((d) => d.window_end_ms >= d.window_start_ms, {
    message: "window_end_ms must be >= window_start_ms",
  })
  .refine((d) => d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window exceeds the maximum derivable range (visible window only)",
  });

/** A placed occurrence group as returned to the client (camelCase DTO). */
interface RecurringViewGroupResponse {
  periodId: string;
  occurrenceIds: string[];
  countInPeriod: number;
  countPaid: number;
  countUnpaid: number;
  totalDue: number;
  totalPaid: number;
  totalUnpaid: number;
  isDuePeriod: boolean;
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  status: string;
}

interface DeriveRecurringViewResponseData {
  kind: string;
  recurringId: string;
  name: string;
  viewCadence: string;
  groups: RecurringViewGroupResponse[];
}

function map_group_to_response(g: PlacedOccurrenceGroup): RecurringViewGroupResponse {
  return {
    periodId: g.period_id,
    occurrenceIds: g.occurrence_ids,
    countInPeriod: g.count_in_period,
    countPaid: g.count_paid,
    countUnpaid: g.count_unpaid,
    totalDue: g.total_due,
    totalPaid: g.total_paid,
    totalUnpaid: g.total_unpaid,
    isDuePeriod: g.is_due_period,
    isFullyPaid: g.is_fully_paid,
    isPartiallyPaid: g.is_partially_paid,
    status: g.status,
  };
}

export const derive_recurring_view = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 100 },
  async (
    request
  ): Promise<FunctionResponse<DeriveRecurringViewResponseData>> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "derive_recurring_view");
    log_operation_start(span, user_id);

    try {
      const validation = derive_recurring_view_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError("invalid-argument", messages.join("; "), {
          trace_id: ctx.trace_id,
        });
      }
      const input = validation.data;

      const result = await derive_recurring_view_orchestrator(ctx, user_id, {
        kind: input.kind,
        recurring_id: input.recurring_id,
        view_cadence: input.view_cadence,
        window_start_ms: input.window_start_ms,
        window_end_ms: input.window_end_ms,
      });

      if (!result) {
        throw new HttpsError("not-found", "Recurring item not found", {
          trace_id: ctx.trace_id,
        });
      }

      const response_data: DeriveRecurringViewResponseData = {
        kind: result.kind,
        recurringId: result.recurring_id,
        name: result.name,
        viewCadence: result.view_cadence,
        groups: result.groups.map(map_group_to_response),
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
      throw new HttpsError("internal", "Failed to derive recurring view", {
        trace_id: ctx.trace_id,
      });
    }
  }
);
