/**
 * Recompute Budget Spent Orchestrator
 *
 * The Budget-Transaction-Spend-Pipeline consumer of the assignment engine's
 * fan-out. For each touched budget, finds the period(s) containing the
 * transaction's date and RECOMPUTES their `spent`/`pendingSpent`/`remaining`
 * from the currently-assigned splits (invalidation-based — never incremented),
 * then refreshes the affected user_summary documents.
 *
 * Dispatched from the `_jobs` queue as `recompute_budget_spent`.
 *
 * @module orchestrators/budgets/recompute_budget_spent
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { budget_repo } from "../../repositories/budget.repo";
import { compute_budget_spent } from "../../domain/budgets/budget_spend.service";
import { budget_cadence_to_instance } from "../../domain/budgets";
import {
  resolve_spend_splits,
  create_window_txn_loader,
} from "../../resolvers/budgets/budget_spend.resolver";
import { create_job_if_not_exists } from "../../infrastructure/job_queue";
import { transaction_repo } from "../../repositories/transaction.repo";
import { TRANSFER_PAIRING_BUFFER_MS } from "../../domain/periods/edge_transfers.service";

/** Budgets recomputed at once (their reads overlap; shared windows are read once). */
const BUDGET_CONCURRENCY = 4;

/** Payload from the assignment engine's fan-out. */
export interface RecomputeBudgetSpentInput {
  user_id: string;
  /** Budgets whose spend may have changed (before ∪ after). */
  budget_ids: string[];
  /**
   * The transaction's date — scopes recompute to the period(s) containing it.
   * OMITTED by the backfill, which recomputes EVERY period of each budget
   * (needed because spent must be rebuilt even where no assignment changed).
   */
  transaction_date_ms?: number;
  /**
   * Many dates at once (a sync's follow-up pass): budget id → transaction dates. Recomputes each
   * budget's periods containing ANY of its dates, in one job — instead of one job per day.
   */
  dates_ms_by_budget?: Record<string, number[]>;
  /**
   * Read the user's transactions across ALL the affected periods ONCE and slice each window from
   * memory (a convert touches ~100 windows of one year; each was its own read). Opt-in: callers
   * that don't pass it read exactly as before.
   */
  preload_window?: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Recompute spent for the touched budgets' affected periods.
 *
 * @returns Count of periods updated.
 */
export async function recompute_budget_spent_orchestrator(
  ctx: TraceContext,
  input: RecomputeBudgetSpentInput
): Promise<{ periods_updated: number }> {
  const span = create_span(ctx, "orchestrator", "recompute_budget_spent");
  log_operation_start(span, input.user_id);

  try {
    const affected_period_ids: string[] = [];
    let periods_updated = 0;

    // GATHER (reads only, budgets in parallel): each budget's cadence + the periods to recompute.
    const gather = async (budget_id: string) => {
      // Read the budget once: its `period` selects which split-lens field spend is
      // matched on (monthly→monthlyBudgetId, weekly→weeklyBudgetId, …), applied to
      // ALL its periods (prime + non-prime). Reused for the rollover gate below.
      const budget = await budget_repo.get_by_id(ctx, budget_id);
      // A GROUP budget's spend comes from every member's shared accounts; this job only loads
      // the user's own transactions, so it would store a partial number. Group views derive
      // their budgets on read — leave the group budget's stored mirror alone.
      if (budget && String(budget.user_id ?? "").startsWith("group:")) {
        return null;
      }
      const cadence = budget
        ? budget_cadence_to_instance(budget.period)
        : "monthly";
      // Date-scoped (engine fan-out) reads only the periods that could CONTAIN the txn date
      // (periodStart within 40d before it) — not the budget's whole lifetime (~138 docs) —
      // then keeps the exact containing period(s). Full mode (backfill, no date) reads all.
      const many = input.dates_ms_by_budget?.[budget_id];
      const periods =
        many !== undefined || input.transaction_date_ms === undefined
          ? await budget_period_repo.get_by_budget_id(ctx, budget_id)
          : await budget_period_repo.get_by_budget_id_in_date_window(
            ctx,
            budget_id,
            input.transaction_date_ms
          );
      const contains = (ms: number) => (p: (typeof periods)[number]) =>
        ms >= p.start_date.toMillis() && ms <= p.end_date.toMillis();
      const affected =
        many !== undefined
          ? periods.filter((p) => many.some((ms) => contains(ms)(p)))
          : input.transaction_date_ms === undefined
            ? periods
            : periods.filter(contains(input.transaction_date_ms));
      return affected.length === 0 ? null : { budget_id, budget, cadence, affected };
    };
    const gathered: Array<NonNullable<Awaited<ReturnType<typeof gather>>>> = [];
    for (let i = 0; i < input.budget_ids.length; i += BUDGET_CONCURRENCY) {
      const chunk = await Promise.all(input.budget_ids.slice(i, i + BUDGET_CONCURRENCY).map(gather));
      for (const g of chunk) if (g) gathered.push(g);
    }

    // One read per distinct period window for the whole job (budgets share windows) — or, in
    // preload mode, ONE read covering every affected period (± the transfer-pairing slack).
    let preloaded: Parameters<typeof create_window_txn_loader>[2];
    if (input.preload_window && gathered.length > 0) {
      const all = gathered.flatMap((g) => g.affected);
      const lo_ms = Math.min(...all.map((p) => p.start_date.toMillis())) - TRANSFER_PAIRING_BUFFER_MS;
      const hi_ms = Math.max(...all.map((p) => p.end_date.toMillis())) + TRANSFER_PAIRING_BUFFER_MS;
      preloaded = { lo_ms, hi_ms, txns: await transaction_repo.get_active_in_date_range(ctx, input.user_id, lo_ms, hi_ms) };
    }
    const load_txns = create_window_txn_loader(ctx, input.user_id, preloaded);

    // COMPUTE + WRITE (budgets in parallel; windows are memoized, so shared reads happen once).
    const apply = async ({ budget_id, budget, cadence, affected }: (typeof gathered)[number]) => {
      const updates: Array<{
        id: string;
        spent: number;
        pending_spent: number;
        remaining: number;
        return_amount: number;
      }> = [];
      for (const p of affected) {
        const start_ms = p.start_date.toMillis();
        const end_ms = p.end_date.toMillis();
        const splits = await resolve_spend_splits(
          ctx,
          input.user_id,
          budget_id,
          start_ms,
          end_ms,
          cadence,
          load_txns
        );
        const { spent, pending_spent, return_amount } = compute_budget_spent(
          budget_id,
          start_ms,
          end_ms,
          splits
        );
        const effective =
          p.effective_amount ?? p.allocated_amount + p.rolled_over_amount;
        updates.push({
          id: p.id,
          spent,
          pending_spent,
          remaining: round2(effective - spent),
          return_amount,
        });
        affected_period_ids.push(p.id);
      }

      await budget_period_repo.update_spent(ctx, updates);
      periods_updated += updates.length;

      // Real-time rollover (the other half of the daily `calculateDailyRollover`
      // catch-up): a spend change invalidates this budget's rollover chain. Only
      // budgets with rollover ENABLED need it, so gate on a single budget read
      // and enqueue an async chain recompute (deduped per budget). The chain
      // writes rolledOverAmount/remaining — never spent — so it cannot re-enter
      // this pipeline. Non-fatal: a rollover hiccup must not fail the spend recompute.
      try {
        if (budget?.rollover_enabled) {
          await create_job_if_not_exists(
            "recalculate_rollover",
            {
              user_id: input.user_id,
              budget_id,
              deduplication_key: budget_id,
            },
            { trace_id: ctx.trace_id }
          );
        }
      } catch (rollover_error) {
        console.error(
          `[${ctx.trace_id}] recompute_budget_spent: rollover enqueue failed (non-fatal):`,
          rollover_error
        );
      }
    };
    for (let i = 0; i < gathered.length; i += BUDGET_CONCURRENCY) {
      await Promise.all(gathered.slice(i, i + BUDGET_CONCURRENCY).map(apply));
    }

    // (user_summaries build retired)

    log_operation_success(span, input.user_id);
    return { periods_updated };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "RECOMPUTE_BUDGET_SPENT_FAILED" }
    );
    throw error;
  }
}
