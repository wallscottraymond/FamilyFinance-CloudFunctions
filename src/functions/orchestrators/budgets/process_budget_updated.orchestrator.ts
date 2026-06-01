/**
 * Process Budget Updated (Cascade Job Handler)
 *
 * Runs asynchronously after a budget is updated. Performs:
 * 1. Category claims (added) — remove from prior owners.
 * 2. Category releases (removed) — return to Everything Else.
 * 3. Re-allocates existing periods IN PLACE when the amount changed (preserving
 *    per-period user data: notes, checklist, modified amounts, and historical
 *    periods).
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
import {
  compute_budget_periods,
  compute_reallocated_periods,
} from "../../domain/budgets/period_generation.service";
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

  // 3. Re-allocate periods if the amount changed.
  if (payload.regenerate_periods) {
    await reallocate_periods(ctx, payload);
  }

  // 4. Propagate a renamed budget to its current+future periods.
  if (payload.name_changed) {
    await propagate_name(ctx, payload);
  }

  log_operation_success(span, payload.user_id);
}

/**
 * Updates the denormalized budgetName on current+future periods after a rename
 * and recomputes their summaries. Historical periods are left unchanged.
 */
async function propagate_name(
  ctx: TraceContext,
  payload: ProcessBudgetUpdatedPayload
): Promise<void> {
  const existing = await budget_period_repo.get_by_budget_id(ctx, payload.budget_id);
  const cutoff = start_of_today_utc().toMillis();
  const ids = existing
    .filter((p) => p.end_date.toMillis() >= cutoff)
    .map((p) => p.id);
  if (ids.length === 0) {
    return;
  }

  await budget_period_repo.update_names(ctx, ids, payload.budget_name);

  try {
    await enqueue_user_summary_updates_from_budget_periods(ctx, payload.user_id, ids);
  } catch (summary_error) {
    console.error(
      `[${ctx.trace_id}] process_budget_updated: name summary update failed (non-fatal):`,
      summary_error
    );
  }
}

/**
 * Start of today (UTC midnight) — periods ending on/after this are re-allocated.
 */
function start_of_today_utc(): Timestamp {
  const now = new Date();
  return Timestamp.fromDate(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  );
}

/**
 * Re-allocates existing periods in place for the new amount, preserving
 * per-period user data and historical periods. Falls back to generating fresh
 * periods only if the budget has none yet (an anomaly — periods are created on
 * budget creation).
 */
async function reallocate_periods(
  ctx: TraceContext,
  payload: ProcessBudgetUpdatedPayload
): Promise<void> {
  const existing = await budget_period_repo.get_by_budget_id(ctx, payload.budget_id);

  if (existing.length === 0) {
    await generate_fresh_periods(ctx, payload);
    return;
  }

  const computed = compute_reallocated_periods({
    new_amount: payload.amount,
    budget_cadence: payload.cadence,
    cutoff: start_of_today_utc(),
    periods: existing.map((p) => ({
      id: p.id,
      period_type: p.period_type,
      start_date: p.start_date,
      end_date: p.end_date,
      spent: p.spent,
      rolled_over_amount: p.rolled_over_amount,
    })),
  });

  const updates = computed.entities ?? [];
  if (updates.length === 0) {
    return;
  }

  await budget_period_repo.update_allocations(ctx, updates);

  try {
    await enqueue_user_summary_updates_from_budget_periods(
      ctx,
      payload.user_id,
      updates.map((u) => u.id)
    );
  } catch (summary_error) {
    console.error(
      `[${ctx.trace_id}] process_budget_updated: summary update failed (non-fatal):`,
      summary_error
    );
  }
}

/**
 * Generates periods from source periods (no existing periods to preserve).
 * Used only as a fallback when an amount-change update finds no periods.
 */
async function generate_fresh_periods(
  ctx: TraceContext,
  payload: ProcessBudgetUpdatedPayload
): Promise<void> {
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

  // Recompute user_summary documents for the freshly generated periods.
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
