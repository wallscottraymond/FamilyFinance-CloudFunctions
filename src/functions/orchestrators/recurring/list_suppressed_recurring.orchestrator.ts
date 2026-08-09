/**
 * List Suppressed Recurring Orchestrator
 *
 * READ-ONLY: the user's currently removed/paused recurring items (bills + income)
 * for the recovery screen. Suppression state is computed SERVER-SIDE from each
 * item's `removal_intervals` (single source of truth) — so a pause that has
 * auto-resumed is correctly excluded without any write. Active items are omitted.
 *
 * @module orchestrators/recurring/list_suppressed_recurring
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { current_removal_state } from "../../domain/recurring/recurring_suppression.service";

export interface SuppressedRecurringItem {
  kind: "outflow" | "inflow";
  id: string;
  name: string;
  status: "removed" | "paused";
  /** For `paused`: when it auto-resumes. */
  resume_ms: number | null;
}

export interface ListSuppressedRecurringResult {
  items: SuppressedRecurringItem[];
}

export async function list_suppressed_recurring_orchestrator(
  ctx: TraceContext,
  user_id: string,
  now_ms: number
): Promise<ListSuppressedRecurringResult> {
  const span = create_span(ctx, "orchestrator", "list_suppressed_recurring");
  log_operation_start(span, user_id);

  try {
    const [outflows, inflows] = await Promise.all([
      outflow_repo.get_by_user_id(ctx, user_id, { include_deleted: true }),
      inflow_repo.get_by_user_id(ctx, user_id, { include_deleted: true }),
    ]);

    const items: SuppressedRecurringItem[] = [];

    for (const o of outflows) {
      const state = current_removal_state(o.removal_intervals, now_ms);
      if (state.status === "active") continue;
      items.push({
        kind: "outflow",
        id: o.id,
        name: o.user_custom_name || o.merchant_name || o.description || "Bill",
        status: state.status,
        resume_ms: state.resume_ms,
      });
    }

    for (const i of inflows) {
      const state = current_removal_state(i.removal_intervals, now_ms);
      if (state.status === "active") continue;
      items.push({
        kind: "inflow",
        id: i.id,
        name: i.user_custom_name || i.payer_name || i.description || "Income",
        status: state.status,
        resume_ms: state.resume_ms,
      });
    }

    log_operation_success(span, user_id);
    return { items };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id }
    );
    throw error;
  }
}
