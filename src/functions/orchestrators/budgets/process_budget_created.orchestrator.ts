/**
 * Process Budget Created (Cascade Job Handler)
 *
 * Runs asynchronously after a budget is created. Performs the heavy work:
 * 1. Transfers claimed categories away from their previous owners.
 * 2. Generates budget periods from source periods.
 *
 * Reimplemented in the layered architecture (domain computes, repos persist) —
 * does not call the legacy category-transfer / period-generation utilities.
 *
 * @module orchestrators/budgets/process_budget_created
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
import { create_job } from "../../infrastructure/job_queue";
import { reassign_view, REHOME_BACK_MS } from "../sharing/view_reassign";
import { ProcessBudgetCreatedPayload } from "../../types/budgets/create_budget.types";

/**
 * Processes the create cascade.
 */
export async function process_budget_created_orchestrator(
  ctx: TraceContext,
  payload: ProcessBudgetCreatedPayload
): Promise<void> {
  const span = create_span(ctx, "orchestrator", "process_budget_created");
  log_operation_start(span, payload.user_id);

  // 1. Apply category claims: remove each claimed category from its previous
  //    owner. Unassigned (null) categories fall to Everything Else if present.
  await apply_claims(
    ctx,
    payload.claims,
    payload.budget_id,
    payload.everything_else_budget_id,
    payload.user_id
  );

  // 2. Generate budget periods from source periods in the budget's range.
  await generate_periods(ctx, payload);

  // 3. Re-home cascade: existing transactions on Everything Else within this
  //    budget's range may now match it (it owns the claimed categories) — re-run
  //    assignment so their spend moves EE → this budget. Idempotent: a split
  //    that doesn't match no-ops.
  await rehome_claimed_transactions(ctx, payload);

  log_operation_success(span, payload.user_id);
}

/**
 * Re-assign the view's transactions from the earliest affected budget start, through the ONE
 * bounded re-assign engine (canon A3b / Transaction-Integrity-Review 3-R): moves splits from
 * Everything Else AND from the budgets this one took categories from (the old path only looked at
 * Everything Else, so a split on a source budget stayed there).
 */
async function rehome_claimed_transactions(
  ctx: TraceContext,
  payload: ProcessBudgetCreatedPayload
): Promise<void> {
  if (payload.category_ids.length === 0) return;
  await reassign_view(
    ctx,
    payload.user_id,
    (payload.rehome_from_ms ?? payload.start_ms) - REHOME_BACK_MS
  );
}

/**
 * Groups claims by source budget and removes the categories from each.
 */
async function apply_claims(
  ctx: TraceContext,
  claims: Array<{ category_id: string; from_budget_id: string | null }>,
  target_budget_id: string,
  everything_else_budget_id: string | null,
  user_id: string
): Promise<void> {
  const removals = new Map<string, string[]>();
  for (const claim of claims) {
    const source = claim.from_budget_id ?? everything_else_budget_id;
    if (!source || source === target_budget_id) {
      continue;
    }
    const list = removals.get(source) ?? [];
    list.push(claim.category_id);
    removals.set(source, list);
  }

  for (const [source_budget_id, category_ids] of removals) {
    await budget_repo.remove_category_ids(ctx, source_budget_id, category_ids, user_id);
  }
}

/**
 * Reads source periods in range, computes period entities, and saves them.
 */
async function generate_periods(
  ctx: TraceContext,
  payload: ProcessBudgetCreatedPayload
): Promise<void> {
  const anchor = Timestamp.fromMillis(payload.start_ms);
  const generation_end = Timestamp.fromMillis(payload.generation_end_ms);

  // Overlap window: every source period from the budget start through the
  // 12-month (ongoing) / budget-end (limited) horizon, including the current
  // partial period.
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
    category_ids: payload.category_ids,
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

  // EE budgets (prime_only) appear in their OWN lens only — keep just prime
  // periods so a monthly-EE's non-prime weekly period can't double-count against
  // the weekly-EE in the weekly view.
  const entities = payload.prime_only
    ? computed.entities.filter((e) => e.is_prime === true)
    : computed.entities;

  await budget_period_repo.save_batch(ctx, entities, payload.budget_name);

  // (user_summaries build retired)

  // Write back period-range metadata (legacy parity).
  await write_back_period_range(ctx, payload, entities, generation_end);

  // Periods now exist — recompute spend from any already-assigned splits. This
  // closes the race where transactions were assigned to this budget BEFORE its
  // periods existed (the assignment fan-out recompute found no periods and
  // wrote nothing). Full recompute (no transaction_date_ms → every period).
  await create_job(
    "recompute_budget_spent",
    { user_id: payload.user_id, budget_ids: [payload.budget_id] },
    { trace_id: ctx.trace_id }
  );
}

/**
 * Writes activePeriodRange + lastExtended (+ extension flags for recurring)
 * onto the budget, derived from the generated prime-type periods.
 */
async function write_back_period_range(
  ctx: TraceContext,
  payload: ProcessBudgetCreatedPayload,
  entities: { period_id: string; period_type: string }[],
  generation_end: Timestamp
): Promise<void> {
  const prime = entities.filter((e) => e.period_type === payload.cadence);
  if (prime.length === 0) {
    return;
  }
  const start_period_id = prime[0].period_id;
  const end_period_id = prime[prime.length - 1].period_id;
  try {
    await budget_repo.set_period_range(
      ctx,
      payload.budget_id,
      start_period_id,
      end_period_id,
      generation_end,
      payload.is_recurring,
      payload.user_id
    );
  } catch (range_error) {
    console.error(
      `[${ctx.trace_id}] process_budget_created: period-range write-back failed (non-fatal):`,
      range_error
    );
  }
}
