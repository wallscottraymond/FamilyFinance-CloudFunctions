/**
 * Derive Period Orchestrator (batched)
 *
 * Read-only coordination for a whole period view in ONE call: budgets (derived,
 * on-read matched), bills, and income for the requested cadence + window. Loads
 * the shared data once (resolver) then loops the pure services in memory —
 * collapsing the client's ~N callable round-trips into one and removing the
 * per-item re-reads.
 *
 * @module orchestrators/periods/derive_period
 */

import {
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
  is_budget_exceeded,
} from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { resolve_period_derivation_deps } from "../../resolvers/periods/period_derivation.resolver";
import {
  compute_period_view,
  DerivePeriodResult,
} from "../../domain/periods/period_view.service";
export type {
  DerivedBudgetResult,
  DerivedRecurringResult,
  DerivePeriodResult,
} from "../../domain/periods/period_view.service";
import { PeriodInstanceType } from "../../domain/budgets";
import {
  resolve_view_version,
  view_key_for,
} from "../../resolvers/periods/view_version.resolver";
import { DeriveScopeRequest } from "../../domain/periods/derive_scope.service";
import {
  get_cached_derived_period,
  put_cached_derived_period,
} from "../../repositories/derive_period_cache.repo";

const BUDGET: PerformanceBudget = { max_reads: 200, max_writes: 0, max_time_ms: 1500 };

/**
 * TTL SAFETY BACKSTOP for the L2 derive cache ([[Firestore-Read-Cost-Reduction]]).
 * Correctness comes from the per-user `data_version` match — this only bounds staleness
 * to minutes (rather than forever) in the event some write path forgot to bump the version.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface DerivePeriodInput {
  view_cadence: PeriodInstanceType;
  window_start_ms: number;
  window_end_ms: number;
  /** Bypass the cached result and recompute fresh (still overwrites the cache with the result,
   *  stamped at the current version). Used by the FE right after a config mutation. */
  force?: boolean;
  /** Account-Rooted-Sharing: which view (default Me). A group view needs membership. */
  scope?: DeriveScopeRequest;
}

export async function derive_period_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: DerivePeriodInput
): Promise<DerivePeriodResult> {
  const span = create_span(ctx, "orchestrator", "derive_period");
  const perf = create_performance_metrics();
  log_operation_start(span, user_id);

  try {
    // L2 CACHE ([[Firestore-Read-Cost-Reduction]]): read the user's current derive-input
    // version + any cached result for this exact (cadence, window) — 2 reads. Serve the
    // cache iff the versions match AND it's within the TTL backstop, skipping the
    // ~9-collection fan-out + in-memory derivation below.
    //
    // `force` (set by the FE right after a config mutation) skips the cache SERVE entirely so the
    // edit reflects immediately without waiting out the async version-bump race / TTL backstop.
    // We still read the current version (to stamp the overwrite) but skip the cached-doc read.
    // Cache key + version per VIEW: Me = the user (exactly as before); a group = "group:<id>"
    // with a members-aware version (membership is checked even on a cache hit).
    let data_version: number;
    const view_key = view_key_for(user_id, input.scope);
    if (input.force) {
      data_version = (await resolve_view_version(ctx, user_id, input.scope)).version;
      perf.reads += 1;
    } else {
      const [vv, cached] = await Promise.all([
        resolve_view_version(ctx, user_id, input.scope),
        get_cached_derived_period<DerivePeriodResult>(
          view_key,
          input.view_cadence,
          input.window_start_ms,
          input.window_end_ms
        ),
      ]);
      perf.reads += 2;
      data_version = vv.version;
      if (
        cached &&
        cached.data_version === data_version &&
        Date.now() - cached.computed_at_ms < CACHE_TTL_MS
      ) {
        log_operation_success(span, user_id);
        return cached.result;
      }
    }

    const deps = await resolve_period_derivation_deps(
      ctx,
      user_id,
      input.view_cadence,
      input.window_start_ms,
      input.window_end_ms,
      input.scope
    );
    perf.reads += 7;

    const { budgets, bills, income } = compute_period_view(deps, input.view_cadence);

    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(`[${ctx.trace_id}] Performance budget exceeded for derive_period`);
    }
    log_operation_success(span, user_id);
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "derive_period",
        status: "success",
        output: {
          view_cadence: input.view_cadence,
          budgets: budgets.length,
          bills: bills.length,
          income: income.length,
          splits: deps.splits_for_match.length,
        },
      })
    );

    const result: DerivePeriodResult = {
      view_cadence: input.view_cadence,
      budgets,
      bills,
      income,
    };

    // Store the freshly-computed result stamped with the version it was computed at
    // (fire-and-forget — a cache-write failure must never fail the derive). Uses the
    // version read at the TOP of this call: if a bump landed mid-compute, the stamp is
    // now stale, so the next read misses and recomputes — never serving stale data.
    fire_and_forget(() =>
      put_cached_derived_period(
        view_key,
        input.view_cadence,
        input.window_start_ms,
        input.window_end_ms,
        data_version,
        result
      )
    );

    return result;
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "DERIVE_PERIOD_FAILED" }
    );
    throw error;
  }
}
