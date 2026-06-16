/**
 * Regenerate Recurring Occurrences Orchestrator
 * (Recurring-Period-Reconciliation B — the `regenerate_recurring_occurrences` job body)
 *
 * Re-derives the occurrence data (`occurrenceDueDates`, `amountPerOccurrence`,
 * `numberOfOccurrencesInPeriod`, `expectedAmount`, ...) for a recurring doc's
 * EXISTING periods using the correct v2 generation domain, then MERGE-writes ONLY
 * those generation fields (preserving each period's reconciliation/payment state).
 * Finally enqueues a `reconcile_recurring_period` so status recomputes against the
 * corrected occurrence data.
 *
 * This fixes legacy periods that were generated without occurrence data (or with
 * stale/out-of-range dates), so multi-occurrence tracking ("paid twice" / weekly
 * bill in a monthly view) is accurate on the existing backlog — not just new docs.
 *
 * @module orchestrators/recurring/regenerate_recurring_occurrences
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext, get_entities, has_errors } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { create_job } from "../../infrastructure/job_queue";
import { resolve_outflow_period_dependencies } from "../../resolvers/outflows";
import { resolve_inflow_period_dependencies } from "../../resolvers/inflows";
import { compute_outflow_periods, validate_outflow_periods } from "../../domain/outflows";
import { compute_inflow_periods, validate_inflow_periods } from "../../domain/inflows";
import { outflow_period_repo } from "../../repositories/outflow_period.repo";
import { inflow_period_repo } from "../../repositories/inflow_period.repo";
import { RecurringType } from "../../resolvers/recurring/period_reconciliation.resolver";

export interface RegenerateRecurringOccurrencesInput {
  recurring_id: string;
  recurring_type: RecurringType;
  user_id: string;
  trace_id: string;
}

export interface RegenerateRecurringOccurrencesResult {
  periods_updated: number;
  reconcile_enqueued: boolean;
  success: boolean;
}

export async function regenerate_recurring_occurrences_orchestrator(
  ctx: TraceContext,
  input: RegenerateRecurringOccurrencesInput
): Promise<RegenerateRecurringOccurrencesResult> {
  const span = create_span(ctx, "orchestrator", "regenerate_recurring_occurrences");
  log_operation_start(span, input.user_id);

  try {
    const now = Timestamp.now();
    let periods_updated = 0;

    if (input.recurring_type === "outflow") {
      // 1. Resolve outflow + source periods, 2. compute correct occurrence data.
      const deps = await resolve_outflow_period_dependencies(ctx, {
        outflow_id: input.recurring_id,
        user_id: input.user_id,
      });
      if (deps.source_periods.length > 0) {
        const computed = compute_outflow_periods(deps.outflow, deps.source_periods, now);
        if (has_errors(computed)) {
          throw new Error((computed.validation_errors ?? []).join("; "));
        }
        const validation = validate_outflow_periods(get_entities(computed));
        if (has_errors(validation)) {
          throw new Error((validation.validation_errors ?? []).join("; "));
        }
        // 3. Merge occurrence fields into EXISTING periods only (preserve payments).
        const existing = new Set(
          await outflow_period_repo.get_by_outflow_id(ctx, input.recurring_id)
        );
        const to_update = get_entities(validation).filter((p) => existing.has(p.id));
        const writes = await outflow_period_repo.update_occurrence_fields(ctx, to_update);
        periods_updated = writes.length;
      }
    } else {
      const deps = await resolve_inflow_period_dependencies(ctx, {
        inflow_id: input.recurring_id,
        user_id: input.user_id,
      });
      if (deps.source_periods.length > 0) {
        const computed = compute_inflow_periods(deps.inflow, deps.source_periods, now);
        if (has_errors(computed)) {
          throw new Error((computed.validation_errors ?? []).join("; "));
        }
        const validation = validate_inflow_periods(get_entities(computed));
        if (has_errors(validation)) {
          throw new Error((validation.validation_errors ?? []).join("; "));
        }
        const existing = new Set(
          await inflow_period_repo.get_by_inflow_id(ctx, input.recurring_id)
        );
        const to_update = get_entities(validation).filter((p) => existing.has(p.id));
        const writes = await inflow_period_repo.update_occurrence_fields(ctx, to_update);
        periods_updated = writes.length;
      }
    }

    // 4. Recompute reconciliation against the corrected occurrence data.
    await create_job(
      "reconcile_recurring_period",
      {
        recurring_id: input.recurring_id,
        recurring_type: input.recurring_type,
        user_id: input.user_id,
        trace_id: ctx.trace_id,
      },
      { trace_id: ctx.trace_id }
    );

    console.log(
      `[${ctx.trace_id}] regenerate_recurring_occurrences: ${input.recurring_type}=${input.recurring_id}, ` +
        `periods_updated=${periods_updated}, reconcile enqueued`
    );
    log_operation_success(span, input.user_id);
    return { periods_updated, reconcile_enqueued: true, success: true };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "REGENERATE_RECURRING_OCCURRENCES_FAILED" }
    );
    throw error;
  }
}
