/**
 * Update Budget Orchestrator
 *
 * Synchronous path for updating a budget: idempotency → resolve → compute →
 * persist → enqueue cascade. Category transfer and period regeneration are
 * deferred to the process_budget_updated job.
 *
 * @module orchestrators/budgets/update_budget
 */

import { plan_view_claims } from "../../domain/budgets/category_ownership.service";
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { ValidationError } from "../../types/errors";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_idempotent_return,
} from "../../observability";
import {
  check_idempotency,
  claim_key,
  complete_key,
  fail_key,
} from "../../infrastructure/idempotency_store";
import { create_job } from "../../infrastructure/job_queue";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import {
  iso_from_day,
  pause_recompute_dates,
  resume_on_recategorize,
  utc_day,
} from "../../domain/budgets/budget_pause.service";
import { BudgetEntity } from "../../types/budgets/budget_entity.types";

/** Stored-spent days recomputed after an auto-resume (≤ one period, as for a return). */
const RESUME_RECOMPUTE_DAYS = 31;
/** Compare-and-set retries for the auto-resume's pause write. */
const MAX_RESUME_ATTEMPTS = 3;
import { budget_repo } from "../../repositories/budget.repo";
import { compute_update_budget } from "../../domain/budgets/update_budget.service";
import {
  budget_cadence_to_instance,
  budget_amount_per_instance,
  compute_period_generation_end,
} from "../../domain/budgets/period_generation.service";
import { resolve_update_budget_dependencies } from "../../resolvers/budgets/update_budget.resolver";
import {
  UpdateBudgetInput,
  UpdateBudgetResponse,
  ProcessBudgetUpdatedPayload,
} from "../../types/budgets/update_budget.types";

/** Clears the paused days from today on, compare-and-set; a concurrent change is re-read. */
async function apply_auto_resume(
  ctx: TraceContext,
  existing: BudgetEntity,
  entity: BudgetEntity,
  user_id: string
): Promise<void> {
  let expected = existing.paused_ranges ?? [];
  let next = entity.paused_ranges ?? [];
  for (let attempt = 0; attempt < MAX_RESUME_ATTEMPTS; attempt++) {
    const written = await budget_repo.replace_paused_ranges_if_unchanged(
      ctx, entity.id, expected, next, user_id
    );
    if (written) return;
    expected = (await budget_repo.get_by_id(ctx, entity.id))?.paused_ranges ?? [];
    const again = resume_on_recategorize({
      before_category_ids: [],
      after_category_ids: entity.category_ids,
      paused_ranges: expected,
      now_ms: entity.updated_at.toMillis(),
    });
    if (!again) return; // nothing is paused from today on any more
    next = again;
  }
  throw new Error("The budget kept changing — try again");
}

/** Derive bump (after the write) + stored spent, so rollover follows. Never throws. */
async function auto_resume_follow_ups(ctx: TraceContext, entity: BudgetEntity): Promise<void> {
  try {
    await bump_derive_version(entity.user_id);
  } catch (error) {
    console.error(`[${ctx.trace_id}] auto-resume bump failed (non-fatal):`, error);
  }
  try {
    const today = utc_day(Date.now());
    await create_job(
      "recompute_budget_spent",
      {
        user_id: entity.user_id,
        budget_ids: [entity.id],
        dates_ms_by_budget: {
          [entity.id]: pause_recompute_dates(
            iso_from_day(today), iso_from_day(today + RESUME_RECOMPUTE_DAYS)
          ),
        },
        force_rollover: true,
      },
      { trace_id: ctx.trace_id }
    );
  } catch (error) {
    console.error(`[${ctx.trace_id}] auto-resume recompute enqueue failed (non-fatal):`, error);
  }
}

/**
 * Updates a budget.
 */
export async function update_budget_orchestrator(
  ctx: TraceContext,
  user_id: string,
  idempotency_key: string,
  input: UpdateBudgetInput
): Promise<UpdateBudgetResponse> {
  const span = create_span(ctx, "orchestrator", "update_budget");
  log_operation_start(span, user_id);

  const check = await check_idempotency(ctx, idempotency_key);
  if (check.is_duplicate) {
    if (check.status === "completed") {
      log_idempotent_return(span, user_id);
      return check.cached_result as UpdateBudgetResponse;
    }
    if (check.status === "in_progress") {
      throw new Error("Request already in progress");
    }
  }

  const claimed = await claim_key(ctx, idempotency_key);
  if (!claimed) {
    throw new Error("Request already in progress");
  }

  try {
    // 1. Resolve (loads existing budget + category deltas)
    const dependencies = await resolve_update_budget_dependencies(ctx, user_id, input);

    // 2. Domain computation (pure) — enforces guardrails, recomputes remaining
    const computed = compute_update_budget({
      user_id,
      input,
      dependencies,
      now: Timestamp.now(),
    });
    if (computed.validation_errors || !computed.entity) {
      throw new ValidationError(computed.validation_errors ?? ["update failed"]);
    }
    const entity = computed.entity;

    // 3. Plan the claims for added categories in THIS budget's view (canon A3/A3b): taken from
    //    the budget that owns them there — refused before any write if that would leave it empty.
    const plan = plan_view_claims({
      budget_id: entity.id,
      added_category_ids: dependencies.added_category_ids,
      view_budgets: dependencies.view_budgets,
      first_of: (id) => dependencies.first_by_category[id] ?? null,
    });
    if (plan.validation_errors || !plan.entity) {
      throw new ValidationError(plan.validation_errors ?? ["category claim failed"]);
    }
    const added_claims = plan.entity.claims;
    const sources = new Set(added_claims.map((c) => c.from_budget_id).filter(Boolean));
    const rehome_from_ms = Math.min(
      entity.start_date.toMillis(),
      ...dependencies.view_budgets.filter((b) => sources.has(b.id)).map((b) => b.start_ms)
    );

    // 4. Persist the updated budget document
    // Auto-resume (S1-M4 follow-up): the domain cleared the paused days from today on. Written
    // compare-and-set (a pause / resume racing this edit is kept — PZ5) and BEFORE the
    // categories, so a retry after a failure in between still sees the empty → non-empty transition.
    const existing = dependencies.existing;
    const resumes =
      JSON.stringify(entity.paused_ranges ?? []) !== JSON.stringify(existing.paused_ranges ?? []);
    if (resumes) await apply_auto_resume(ctx, existing, entity, user_id);
    // Only the fields this edit changed: a concurrent change to the budget isn't overwritten
    // (M3-M4). The pause isn't one of them here: it was written above.
    await budget_repo.save_changes(ctx, existing, {
      ...entity,
      paused_ranges: existing.paused_ranges,
    });

    // 4b. The budget write landed, so these can't fail the request: a retry would find the
    //     categories already saved and skip the claims / re-home below (verify L4). The on-write
    //     trigger bumps too, and the next change / nightly job catches the recompute up.
    if (resumes) await auto_resume_follow_ups(ctx, entity);

    // 5. Enqueue cascade (claims/releases + period reallocation + rename)
    const name_changed = entity.name !== dependencies.existing.name;
    // An end-date / ongoing change moves which dates the budget owns → its transactions re-home.
    const end_ms = (b: { is_ongoing: boolean; budget_end_date?: { toMillis(): number } | null }) =>
      b.is_ongoing ? null : b.budget_end_date?.toMillis() ?? null;
    const range_changed = end_ms(entity) !== end_ms(dependencies.existing);
    const needs_cascade =
      range_changed ||
      added_claims.length > 0 ||
      dependencies.removed_category_ids.length > 0 ||
      dependencies.amount_changed ||
      name_changed;

    if (needs_cascade) {
      const generation_end = compute_period_generation_end(
        entity.start_date.toDate(),
        entity.is_ongoing,
        entity.budget_end_date ? entity.budget_end_date.toDate() : null
      );
      const payload: ProcessBudgetUpdatedPayload = {
        budget_id: entity.id,
        user_id: entity.user_id, // owner key (PD6): the cascade works in the budget's view
        group_ids: entity.group_ids,
        budget_name: entity.name,
        category_ids: entity.category_ids,
        amount: budget_amount_per_instance(entity.amount, entity.period),
        cadence: budget_cadence_to_instance(entity.period),
        start_ms: entity.start_date.toMillis(),
        generation_end_ms: generation_end.getTime(),
        is_recurring: entity.is_ongoing,
        added_claims,
        released_category_ids: dependencies.removed_category_ids,
        everything_else_budget_id: dependencies.everything_else_budget_id,
        rehome_from_ms,
        range_changed,
        regenerate_periods: dependencies.amount_changed,
        name_changed,
      };
      await create_job("process_budget_updated", payload, { trace_id: ctx.trace_id });
    }

    const response: UpdateBudgetResponse = {
      budget_id: entity.id,
      name: entity.name,
      amount: entity.amount,
      category_ids: entity.category_ids,
      period: entity.period,
      categories_claimed: added_claims.length,
      categories_released: dependencies.removed_category_ids.length,
      processing_background: needs_cascade,
    };
    await complete_key(ctx, idempotency_key, response);

    log_operation_success(span, user_id);
    return response;
  } catch (error) {
    await fail_key(
      ctx,
      idempotency_key,
      error instanceof Error ? error.message : "Unknown error"
    );
    throw error;
  }
}
