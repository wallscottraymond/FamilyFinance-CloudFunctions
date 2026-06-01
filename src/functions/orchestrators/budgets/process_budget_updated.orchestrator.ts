/**
 * Process Budget Updated (Cascade Job Handler)
 *
 * Runs asynchronously after a budget is updated. Performs:
 * 1. Category claims (added) — remove from prior owners.
 * 2. Category releases (removed) — return to Everything Else.
 * 3. Period regeneration when the amount changed (delete + regenerate).
 *
 * @module orchestrators/budgets/process_budget_updated
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { source_period_repo } from "../../repositories/source_period.repo";
import { compute_budget_periods } from "../../domain/budgets/period_generation.service";
import { enqueue_user_summary_updates_from_budget_periods } from "../../orchestrators/summaries";
import { ProcessBudgetUpdatedPayload } from "../../types/budgets/update_budget.types";

/**
 * Processes the update cascade.
 */
export async function process_budget_updated_orchestrator(
  ctx: TraceContext,
  payload: ProcessBudgetUpdatedPayload
): Promise<void> {
  const span = create_span(ctx, "orchestrator", "process_budget_updated");
  log_operation_start(span, payload.user_id);

  // 1. Claims for added categories: remove from prior owners.
  const removals = new Map<string, string[]>();
  for (const claim of payload.added_claims) {
    const source = claim.from_budget_id ?? payload.everything_else_budget_id;
    if (!source || source === payload.budget_id) {
      continue;
    }
    const list = removals.get(source) ?? [];
    list.push(claim.category_id);
    removals.set(source, list);
  }
  for (const [source_budget_id, category_ids] of removals) {
    await budget_repo.remove_category_ids(ctx, source_budget_id, category_ids, payload.user_id);
  }

  // 2. Releases: return removed categories to Everything Else.
  if (
    payload.released_category_ids.length > 0 &&
    payload.everything_else_budget_id
  ) {
    await budget_repo.add_category_ids(
      ctx,
      payload.everything_else_budget_id,
      payload.released_category_ids,
      payload.user_id
    );
  }

  // 3. Regenerate periods if the amount changed.
  if (payload.regenerate_periods) {
    await regenerate_periods(ctx, payload);
  }

  log_operation_success(span, payload.user_id);
}

/**
 * Deletes existing periods and regenerates them with the new amount.
 */
async function regenerate_periods(
  ctx: TraceContext,
  payload: ProcessBudgetUpdatedPayload
): Promise<void> {
  await budget_period_repo.delete_by_budget_id(ctx, payload.budget_id);

  const anchor = Timestamp.fromMillis(payload.start_ms);
  const generation_end = Timestamp.fromMillis(payload.generation_end_ms);
  const source_periods = await source_period_repo.get_overlapping(
    ctx,
    anchor,
    generation_end
  );
  if (source_periods.length === 0) {
    return;
  }

  const computed = compute_budget_periods({
    budget_id: payload.budget_id,
    user_id: payload.user_id,
    group_ids: payload.group_ids,
    budget_amount: payload.amount,
    budget_cadence: payload.cadence,
    source_periods: source_periods.map((sp) => ({
      id: sp.id,
      period_id: sp.period_id,
      period_type: sp.period_type,
      start_date: sp.start_date,
      end_date: sp.end_date,
    })),
    now: Timestamp.now(),
  });

  if (!computed.entities || computed.entities.length === 0) {
    return;
  }

  await budget_period_repo.save_batch(ctx, computed.entities, payload.budget_name);

  // Recompute user_summary documents for the regenerated periods. (The prior
  // periods' removal is handled by the budget_period DELETE summary trigger.)
  const period_ids = computed.entities.map((p) => p.id);
  try {
    await enqueue_user_summary_updates_from_budget_periods(ctx, payload.user_id, period_ids);
  } catch (summary_error) {
    console.error(
      `[${ctx.trace_id}] process_budget_updated: summary update failed (non-fatal):`,
      summary_error
    );
  }

  // Write back the refreshed period-range metadata (legacy parity).
  const prime = computed.entities.filter((e) => e.period_type === payload.cadence);
  if (prime.length > 0) {
    try {
      await budget_repo.set_period_range(
        ctx,
        payload.budget_id,
        prime[0].period_id,
        prime[prime.length - 1].period_id,
        generation_end,
        payload.is_recurring,
        payload.user_id
      );
    } catch (range_error) {
      console.error(
        `[${ctx.trace_id}] process_budget_updated: period-range write-back failed (non-fatal):`,
        range_error
      );
    }
  }
}
