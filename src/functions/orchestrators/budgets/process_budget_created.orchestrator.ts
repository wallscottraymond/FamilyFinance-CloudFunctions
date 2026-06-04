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
import { enqueue_user_summary_updates_from_budget_periods } from "../../orchestrators/summaries";
import { create_job } from "../../infrastructure/job_queue";
import {
  resolve_created_rehome_transaction_ids,
} from "../../resolvers/budgets/budget_rehome.resolver";
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
 * Enqueue re-assignment of transactions currently on Everything Else that fall
 * in the new budget's range, so the engine can move the ones now claimed by it.
 */
async function rehome_claimed_transactions(
  ctx: TraceContext,
  payload: ProcessBudgetCreatedPayload
): Promise<void> {
  const txn_ids = await resolve_created_rehome_transaction_ids(
    ctx,
    payload.user_id,
    payload.budget_id,
    payload.everything_else_budget_id,
    payload.start_ms,
    payload.generation_end_ms
  );
  for (const transaction_id of txn_ids) {
    await create_job(
      "assign_transaction",
      { user_id: payload.user_id, transaction_id },
      { trace_id: ctx.trace_id }
    );
  }
  if (txn_ids.length > 0) {
    console.log(
      `[${ctx.trace_id}] process_budget_created: re-homed ${txn_ids.length} ` +
        `transactions for budget ${payload.budget_id}`
    );
  }
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

  await budget_period_repo.save_batch(ctx, computed.entities, payload.budget_name);

  // Update user_summary documents AFTER all periods are saved (the CREATE
  // summary trigger was removed to avoid batch race conditions). Enqueues one
  // deduplicated job per affected period — cascades across all future summaries.
  const period_ids = computed.entities.map((p) => p.id);
  try {
    await enqueue_user_summary_updates_from_budget_periods(ctx, payload.user_id, period_ids);
  } catch (summary_error) {
    // Non-fatal: a failed summary update must not fail the cascade.
    console.error(
      `[${ctx.trace_id}] process_budget_created: summary update failed (non-fatal):`,
      summary_error
    );
  }

  // Write back period-range metadata (legacy parity).
  await write_back_period_range(ctx, payload, computed.entities, generation_end);

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
