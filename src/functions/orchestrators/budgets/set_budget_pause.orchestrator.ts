/**
 * Set Budget Pause Orchestrator (Code-Health-Review M1-M1, PZ1–PZ6)
 *
 * Pause / resume a budget for exactly the days of one period. Only the budget's `pausedRanges`
 * is written — never a split: read time moves a paused day's spending to Everything Else and
 * takes the paused days' share out of the budget (derive_period, derive_budget_transactions,
 * widgets, Home — one owner rule). Then:
 *   - bump the derive version (24h caches) AFTER the write
 *   - recompute the stored `spent` of the periods holding those days (it leaves paused days out,
 *     so the rollover chain carries exactly what the page shows — PZ6)
 *
 * Idempotent by construction (pause = union, resume = subtract); a concurrent change to the same
 * budget's ranges is retried, never overwritten.
 *
 * @module orchestrators/budgets/set_budget_pause
 */

import { TraceContext } from "../../types";
import { ValidationError } from "../../types/errors";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { bump_derive_version } from "../../repositories/derive_version.repo";
import { create_job } from "../../infrastructure/job_queue";
import { resolve_set_budget_pause_dependencies } from "../../resolvers/budgets/set_budget_pause.resolver";
import {
  compute_budget_pause,
  iso_from_day,
  pause_recompute_dates,
} from "../../domain/budgets/budget_pause.service";
import {
  SetBudgetPauseInput,
  SetBudgetPauseResponse,
} from "../../types/budgets/set_budget_pause.types";

const MAX_ATTEMPTS = 3;

export async function set_budget_pause_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: SetBudgetPauseInput
): Promise<SetBudgetPauseResponse> {
  const span = create_span(ctx, "orchestrator", "set_budget_pause");
  log_operation_start(span, user_id);
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // 1. Resolve (the budget, access-checked)
      const { existing } = await resolve_set_budget_pause_dependencies(ctx, user_id, input.budget_id);
      if (existing.is_fund) throw new ValidationError(["A fund can't be paused"]);
      const current = existing.paused_ranges ?? [];

      // 2. Domain (pure)
      const computed = compute_budget_pause({
        current,
        start_day: input.start_day,
        end_day: input.end_day,
        paused: input.paused,
        is_everything_else: existing.is_system_everything_else === true,
      });
      if (computed.validation_errors || !computed.entity) {
        throw new ValidationError(computed.validation_errors ?? ["pause failed"]);
      }
      const next = computed.entity;

      // 3. Persist (compare-and-set on the ranges)
      const written = await budget_repo.replace_paused_ranges_if_unchanged(
        ctx, existing.id, current, next, user_id
      );
      if (!written) continue; // changed meanwhile → re-read and re-apply

      // 4. Invalidate derive caches after the write (derive-cache 24h rule).
      await bump_derive_version(existing.user_id);

      // 5. The stored spent of those days' periods (and, through it, the rollover chain).
      const dates = pause_recompute_dates(input.start_day, input.end_day);
      if (dates.length > 0) {
        await create_job(
          "recompute_budget_spent",
          {
            user_id: existing.user_id,
            budget_ids: [existing.id],
            dates_ms_by_budget: { [existing.id]: dates },
            force_rollover: true, // the carry into later periods follows the pause now (PZ6)
          },
          { trace_id: ctx.trace_id }
        );
      }

      log_operation_success(span, user_id);
      return {
        paused_ranges: next.map((r) => ({ start: iso_from_day(r.start_day), end: iso_from_day(r.end_day) })),
      };
    }
    throw new Error("The budget kept changing — try again");
  } catch (error) {
    log_operation_error(span, error instanceof Error ? error : new Error(String(error)), {
      user_id,
      error_code: "SET_BUDGET_PAUSE_FAILED",
    });
    throw error;
  }
}
