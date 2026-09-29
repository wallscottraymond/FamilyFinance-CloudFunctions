/**
 * Derive Period RANGE Orchestrator (read-only)
 *
 * Derives MANY period windows of one cadence in a single call (the Home preload: the last 12
 * periods), plus each window's goals view. Per window the result is IDENTICAL to
 * `derive_period` + `derive_goals_view` for that window — same shaping
 * (`shape_period_derivation_deps`), same pure computation (`compute_period_view`,
 * `build_goals_view`) — but the user's definitions + the transactions for the whole range are read
 * ONCE instead of once per window.
 *
 * Shares `derive_period`'s per-window L2 cache (same keys, version-stamped): windows served from
 * the cache skip computation; only the misses are loaded + derived, and their results are written
 * back so a later single-window `derive_period` hits too.
 *
 * @module orchestrators/periods/derive_period_range
 */

import { Timestamp } from "firebase-admin/firestore";
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
import {
  load_period_derivation_raw,
  shape_period_derivation_deps,
} from "../../resolvers/periods/period_derivation.resolver";
import {
  resolve_goal_measurements_for_periods,
} from "../../resolvers/goals/goal_measurement.resolver";
import {
  compute_period_view,
  DerivePeriodResult,
} from "../../domain/periods/period_view.service";
import {
  build_goals_view,
  DeriveGoalsViewResult,
} from "../../domain/goals/goals_view.service";
import { PeriodInstanceType } from "../../domain/budgets";
import { source_period_repo } from "../../repositories/source_period.repo";
import { get_derive_version } from "../../repositories/derive_version.repo";
import {
  get_cached_derived_period,
  put_cached_derived_period,
} from "../../repositories/derive_period_cache.repo";

/**
 * Transactions dominate (a cold 12-month range reads every active txn in it, ~4k for a heavy
 * user); cached windows cost 1 read each. Tracked for visibility, not enforced.
 */
const BUDGET: PerformanceBudget = { max_reads: 6000, max_writes: 0, max_time_ms: 8000 };

/** Same TTL backstop as `derive_period` (correctness comes from the data_version match). */
const CACHE_TTL_MS = 10 * 60 * 1000;

export interface DeriveRangeWindow {
  period_id: string;
  start_ms: number;
  end_ms: number;
}

export interface DerivePeriodRangeInput {
  view_cadence: PeriodInstanceType;
  windows: DeriveRangeWindow[];
  /** Bypass cached results (recompute every window, still writing the cache). */
  force?: boolean;
}

export interface DerivePeriodRangeWindowResult {
  period_id: string;
  start_ms: number;
  end_ms: number;
  derive: DerivePeriodResult;
  /** Null only if the period_id isn't a real source period in the range. */
  goals: DeriveGoalsViewResult | null;
  from_cache: boolean;
}

export interface DerivePeriodRangeResult {
  view_cadence: PeriodInstanceType;
  windows: DerivePeriodRangeWindowResult[];
}

export async function derive_period_range_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: DerivePeriodRangeInput
): Promise<DerivePeriodRangeResult> {
  const span = create_span(ctx, "orchestrator", "derive_period_range");
  const perf = create_performance_metrics();
  log_operation_start(span, user_id);

  try {
    const range_start_ms = Math.min(...input.windows.map((w) => w.start_ms));
    const range_end_ms = Math.max(...input.windows.map((w) => w.end_ms));

    // 1. Version + every window's cached result + the range's source periods (for goal period
    //    dates, exactly as `derive_goals_view` reads them) — one parallel round-trip.
    const [data_version, cached, range_periods] = await Promise.all([
      get_derive_version(user_id),
      input.force
        ? Promise.resolve(input.windows.map(() => null))
        : Promise.all(
          input.windows.map((w) =>
            get_cached_derived_period<DerivePeriodResult>(
              user_id,
              input.view_cadence,
              w.start_ms,
              w.end_ms
            )
          )
        ),
      source_period_repo.get_overlapping(
        ctx,
        Timestamp.fromMillis(range_start_ms),
        Timestamp.fromMillis(range_end_ms)
      ),
    ]);
    perf.reads += 1 + (input.force ? 0 : input.windows.length) + range_periods.length;

    const now_ms = Date.now();
    const results = new Map<number, { derive: DerivePeriodResult; from_cache: boolean }>();
    const misses: number[] = [];
    input.windows.forEach((_, i) => {
      const c = cached[i];
      if (c && c.data_version === data_version && now_ms - c.computed_at_ms < CACHE_TTL_MS) {
        results.set(i, { derive: c.result, from_cache: true });
      } else {
        misses.push(i);
      }
    });

    // 2. Misses: ONE load for all of them, then the per-window shaping + pure derive.
    if (misses.length > 0) {
      const miss_windows = misses.map((i) => ({
        start_ms: input.windows[i].start_ms,
        end_ms: input.windows[i].end_ms,
      }));
      const raw = await load_period_derivation_raw(
        ctx,
        user_id,
        input.view_cadence,
        miss_windows
      );
      perf.reads += 8 + raw.txns.length;

      for (const i of misses) {
        const w = input.windows[i];
        const deps = shape_period_derivation_deps(raw, input.view_cadence, w.start_ms, w.end_ms);
        const derive = compute_period_view(deps, input.view_cadence);
        results.set(i, { derive, from_cache: false });
        // Same version-stamped write as `derive_period` (fire-and-forget; never fails the call).
        fire_and_forget(() =>
          put_cached_derived_period(
            user_id,
            input.view_cadence,
            w.start_ms,
            w.end_ms,
            data_version,
            derive
          )
        );
      }
    }

    // 3. Goals per window (goals read once; each period reads its own balance snapshots).
    const period_by_id = new Map(range_periods.map((p) => [p.period_id, p]));
    const goal_periods = input.windows
      .map((w) => period_by_id.get(w.period_id))
      .filter((p): p is NonNullable<typeof p> => p !== undefined)
      .map((p) => ({ period_id: p.period_id, start: p.start_date, end: p.end_date }));
    const goal_views = await resolve_goal_measurements_for_periods(ctx, user_id, goal_periods);

    const windows: DerivePeriodRangeWindowResult[] = input.windows.map((w, i) => {
      const r = results.get(i)!;
      const views = goal_views.get(w.period_id);
      return {
        period_id: w.period_id,
        start_ms: w.start_ms,
        end_ms: w.end_ms,
        derive: r.derive,
        goals: views ? build_goals_view(w.period_id, views) : null,
        from_cache: r.from_cache,
      };
    });

    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(`[${ctx.trace_id}] Performance budget exceeded for derive_period_range`);
    }
    log_operation_success(span, user_id);
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "derive_period_range",
        status: "success",
        output: {
          view_cadence: input.view_cadence,
          windows: input.windows.length,
          cache_hits: input.windows.length - misses.length,
          reads: perf.reads,
        },
      })
    );

    return { view_cadence: input.view_cadence, windows };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "DERIVE_PERIOD_RANGE_FAILED" }
    );
    throw error;
  }
}
