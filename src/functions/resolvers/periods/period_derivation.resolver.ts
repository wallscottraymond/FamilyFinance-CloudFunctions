/**
 * Period Derivation Resolver (batched)
 *
 * READ-ONLY: load EVERYTHING a period view needs in one batch — the user's
 * budgets (+ their monthly homes), the window's source-period buckets, the
 * window's transaction splits (for on-read budget matching AND recurring
 * reconciliation), and the user's recurring outflows/inflows — so the whole
 * period can be derived in a SINGLE server round-trip instead of one callable
 * per budget/bill/income.
 *
 * Reuses the same pure services as the per-item paths; the win is doing the IO
 * once and looping in memory. No writes.
 *
 * @module resolvers/periods/period_derivation
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  budget_repo,
  outflow_repo,
  inflow_repo,
  source_period_repo,
  SourcePeriodEntity,
} from "../../repositories";
import { SOURCE_PERIOD_OVERLAP_BUFFER_MS } from "../../repositories/source_period.repo";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { goal_repo } from "../../repositories/goal.repo";
import { GoalForLeftover } from "../../domain/budgets/everything_else_leftover.service";
import {
  ViewBucket,
  MonthlyPeriodForDerivation,
} from "../../domain/budgets/budget_view.service";
import { SplitForOnReadMatch } from "../../domain/budgets/budget_spend_match.service";
import { is_transfer_category } from "../../domain/budgets/budget_spend.service";
import {
  detect_internal_transfers_from_txns,
  map_raw_split_to_on_read_match,
} from "../shared/on_read_matching";
import {
  BudgetForMatch,
  PeriodLens,
} from "../../domain/transactions/match_budget.service";
import { PlacementBucket } from "../../domain/recurring/occurrence_placement.service";
import { ActualPayment } from "../../domain/recurring/reconcile_occurrences.service";
import {
  build_stream_membership_map,
  is_txn_detached_from_outflow,
} from "../../domain/recurring/stream_membership";
import { DepositForSlot } from "../../domain/recurring/income_slot_amounts";
import { PeriodInstanceType } from "../../domain/budgets";

function to_cadence(period: string): PeriodLens {
  return period === "weekly" ? "weekly" : period === "bi_monthly" ? "bi_monthly" : "monthly";
}

/**
 * A budget's amount expressed as a MONTHLY-equivalent, given its home cadence —
 * so a synthesized monthly allocation is right regardless of how the budget was
 * authored. Monthly is the target for everyone; weekly/bi-weekly are converted.
 */
function monthly_equivalent_amount(amount: number, period: string): number {
  if (period === "weekly") return amount * (52 / 12); // ~4.33 weeks / month
  if (period === "bi_monthly") return amount * 2; // 2 half-months / month
  return amount; // monthly (and default)
}

export type {
  BudgetForDerivation,
  RecurringForDerivation,
  PeriodDerivationDeps,
} from "../../domain/periods/period_derivation.types";
import type {
  BudgetForDerivation,
  RecurringForDerivation,
  PeriodDerivationDeps,
} from "../../domain/periods/period_derivation.types";

type Awaited2<T> = T extends Promise<infer U> ? U : T;

/**
 * Everything Firestore returns for one OR MORE windows of a cadence — the IO half of period
 * derivation. Loaded once (`load_period_derivation_raw`) and re-filtered per window in memory
 * (`shape_period_derivation_deps`), so a multi-window derive reads the user's definitions and
 * transactions ONCE instead of per window.
 */
export interface PeriodDerivationRaw {
  /** `get_overlapping` result for [min window start, max window end] (ordered by startDate). */
  overlapping: SourcePeriodEntity[];
  budget_entities: Awaited2<ReturnType<typeof budget_repo.get_by_user_id>>;
  monthly_period_docs: Awaited2<ReturnType<typeof budget_period_repo.get_by_user_and_type>>;
  outflows: Awaited2<ReturnType<typeof outflow_repo.get_by_user_id>>;
  inflows: Awaited2<ReturnType<typeof inflow_repo.get_by_user_id>>;
  all_goals: Awaited2<ReturnType<typeof goal_repo.get_by_user>>;
  /** Active transactions across the UNION of every window's derivation span. */
  txns: Array<{ id: string; data: Record<string, unknown> }>;
  /** Historical deposits for a SUPERSET of every window's inflow stream ids. */
  inflow_history_docs: Awaited2<ReturnType<typeof transaction_repo.get_by_plaid_transaction_ids>>;
}

export interface DerivationWindow {
  start_ms: number;
  end_ms: number;
}

/** Exact Firestore Timestamp comparison vs a millis bound (keeps sub-millisecond precision). */
function ts_cmp(ts: Timestamp, ms: number): number {
  const b = Timestamp.fromMillis(ms);
  return ts.seconds !== b.seconds ? ts.seconds - b.seconds : ts.nanoseconds - b.nanoseconds;
}

/**
 * The source periods `source_period_repo.get_overlapping(window_start, window_end)` would return,
 * re-filtered from a wider load with the IDENTICAL predicate (startDate in
 * [start − buffer, end], then end_date ≥ start by millis). Preserves startDate order.
 */
function overlapping_for_window(
  all: SourcePeriodEntity[],
  window_start_ms: number,
  window_end_ms: number
): SourcePeriodEntity[] {
  const lower_ms =
    Timestamp.fromMillis(window_start_ms).toMillis() - SOURCE_PERIOD_OVERLAP_BUFFER_MS;
  return all.filter(
    (p) =>
      ts_cmp(p.start_date, lower_ms) >= 0 &&
      ts_cmp(p.start_date, window_end_ms) <= 0 &&
      p.end_date.toMillis() >= Timestamp.fromMillis(window_start_ms).toMillis()
  );
}

/** A window's derivation span: the extent of its view-cadence buckets (or the window itself). */
function derivation_span(
  overlapping: SourcePeriodEntity[],
  view_cadence: PeriodInstanceType,
  window_start_ms: number,
  window_end_ms: number
): { span_start_ms: number; span_end_ms: number } {
  const buckets = overlapping.filter((p) => p.period_type === view_cadence);
  return {
    span_start_ms: buckets.length
      ? Math.min(...buckets.map((b) => b.start_date.toMillis()))
      : window_start_ms,
    span_end_ms: buckets.length
      ? Math.max(...buckets.map((b) => b.end_date.toMillis()))
      : window_end_ms,
  };
}

/**
 * IO half: read everything the given windows need, ONCE. For a single window this issues the same
 * queries the per-window path always did (the inflow-history lookup covers every active,
 * non-hidden inflow's stream ids — a superset that's re-filtered per window).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** No source / budget period is longer than this. */
const MAX_PERIOD_MS = 31 * DAY_MS;

/**
 * `periodStart` bounds for the monthly budget periods derivation can use for [range_start,
 * range_end] (Read-Cost-Review-Round-3 #5). `shape_period_derivation_deps` keeps only periods
 * overlapping a window's span; a span is built from source periods overlapping the range, so it
 * lies within [range_start − 31d, range_end + 31d], and a kept period (≤ 31d long) must START in
 * [range_start − 62d, range_end + 31d]. Loading exactly that superset leaves the shaped result
 * IDENTICAL to loading all of the user's monthly periods (incl. the "no stored period → synthesize"
 * fallback, which already looks only at span-overlapping periods).
 */
export function monthly_period_load_bounds(
  range_start_ms: number,
  range_end_ms: number
): [number, number] {
  return [range_start_ms - 2 * MAX_PERIOD_MS, range_end_ms + MAX_PERIOD_MS];
}

export async function load_period_derivation_raw(
  ctx: TraceContext,
  user_id: string,
  view_cadence: PeriodInstanceType,
  windows: DerivationWindow[]
): Promise<PeriodDerivationRaw> {
  const range_start_ms = Math.min(...windows.map((w) => w.start_ms));
  const range_end_ms = Math.max(...windows.map((w) => w.end_ms));

  // 1. Everything that only needs user_id + the requested range, in ONE parallel round-trip.
  // Only the transaction read depends on the derived period spans (computed below).
  const [overlapping, budget_entities, monthly_period_docs, outflows, inflows, all_goals] =
    await Promise.all([
      source_period_repo.get_overlapping(
        ctx,
        Timestamp.fromMillis(range_start_ms),
        Timestamp.fromMillis(range_end_ms)
      ),
      budget_repo.get_by_user_id(ctx, user_id),
      budget_period_repo.get_by_user_and_type_starting_between(
        ctx,
        user_id,
        "monthly",
        ...monthly_period_load_bounds(range_start_ms, range_end_ms)
      ),
      outflow_repo.get_by_user_id(ctx, user_id),
      inflow_repo.get_by_user_id(ctx, user_id),
      goal_repo.get_by_user(ctx, user_id),
    ]);

  // 2. Transactions for the UNION of every window's span (one query).
  const spans = windows.map((w) =>
    derivation_span(
      overlapping_for_window(overlapping, w.start_ms, w.end_ms),
      view_cadence,
      w.start_ms,
      w.end_ms
    )
  );
  const txns = await transaction_repo.get_active_in_date_range(
    ctx,
    user_id,
    Math.min(...spans.map((sp) => sp.span_start_ms)),
    Math.max(...spans.map((sp) => sp.span_end_ms))
  );

  // 3. Income history for every candidate inflow stream (superset; re-filtered per window).
  const history_ids = [
    ...new Set(
      inflows
        .filter((i) => i.is_active && !i.is_hidden)
        .flatMap((i) => i.transaction_ids ?? [])
    ),
  ];
  const inflow_history_docs = await transaction_repo.get_by_plaid_transaction_ids(
    ctx,
    user_id,
    history_ids
  );

  return {
    overlapping,
    budget_entities,
    monthly_period_docs,
    outflows,
    inflows,
    all_goals,
    txns,
    inflow_history_docs,
  };
}

/**
 * Lookup/shaping half (NO IO): build ONE window's derivation inputs from a raw load, applying the
 * same predicates the per-window queries apply — so the result is identical to loading that
 * window alone.
 */
export function shape_period_derivation_deps(
  raw: PeriodDerivationRaw,
  view_cadence: PeriodInstanceType,
  window_start_ms: number,
  window_end_ms: number
): PeriodDerivationDeps {
  const { budget_entities, monthly_period_docs, outflows, inflows, all_goals } = raw;
  const overlapping = overlapping_for_window(raw.overlapping, window_start_ms, window_end_ms);

  // Active, income-drawing goals contribute their planned per-period set-aside to
  // the Everything-Else leftover (EE limit = income − bills − goals − budgets).
  const goals: GoalForLeftover[] = all_goals
    .filter((g) => g.status === "active" && g.draws_income)
    .map((g) => ({ per_period_amount: g.per_period_amount, home_cadence: g.home_cadence }));

  // Buckets for the requested cadence overlapping the window.
  const view_buckets: ViewBucket[] = overlapping
    .filter((p) => p.period_type === view_cadence)
    .map((p) => ({
      period_id: p.period_id,
      period_type: view_cadence,
      start_ms: p.start_date.toMillis(),
      end_ms: p.end_date.toMillis(),
    }));
  const placement_buckets: PlacementBucket[] = view_buckets.map((b) => ({
    period_id: b.period_id,
    start_ms: b.start_ms,
    end_ms: b.end_ms,
  }));
  // Monthly source-period boundaries in the window — used to SYNTHESIZE a
  // budget's allocation from its `amount` when it has no materialized monthly
  // period yet (a brand-new budget), so it shows a limit instantly.
  const monthly_source_periods = overlapping
    .filter((p) => p.period_type === "monthly")
    .map((p) => ({ start_ms: p.start_date.toMillis(), end_ms: p.end_date.toMillis() }));
  const span_start_ms = view_buckets.length
    ? Math.min(...view_buckets.map((b) => b.start_ms))
    : window_start_ms;
  const span_end_ms = view_buckets.length
    ? Math.max(...view_buckets.map((b) => b.end_ms))
    : window_end_ms;

  // 2. Budgets + their monthly homes (fetched above, in parallel).
  const monthly_by_budget = new Map<string, MonthlyPeriodForDerivation[]>();
  for (const p of monthly_period_docs) {
    if (p.end_date.toMillis() < span_start_ms || p.start_date.toMillis() > span_end_ms) {
      continue;
    }
    const list = monthly_by_budget.get(p.budget_id) ?? [];
    list.push({
      allocated_amount: p.allocated_amount,
      effective_amount: p.effective_amount,
      start_ms: p.start_date.toMillis(),
      end_ms: p.end_date.toMillis(),
    });
    monthly_by_budget.set(p.budget_id, list);
  }

  const real_budgets: BudgetForMatch[] = [];
  const budgets: BudgetForDerivation[] = [];
  let monthly_ee_id: string | null = null;
  let any_ee_id: string | null = null;
  for (const b of budget_entities) {
    const is_ee = b.is_system_everything_else === true;
    // A budget's allocation covers its WHOLE period, so its SPEND must too — and it must NOT
    // appear in periods before it existed. Snap the effective start DOWN to the start of the
    // (own-cadence) period that contains start_date: a budget created mid-period owns that
    // period's earlier transactions (else `is_within_budget_range` strands pre-creation spend in
    // Everything Else) AND periods entirely before it are omitted downstream. Only the FIRST
    // period is affected — later ones already fall in range; a start predating the fetched window
    // keeps its raw value (already below it). EE is always active, so it never filters out.
    const raw_budget_start_ms = b.start_date.toMillis();
    const home_period_start_ms = overlapping.find(
      (p) =>
        p.period_type === to_cadence(b.period) &&
        raw_budget_start_ms >= p.start_date.toMillis() &&
        raw_budget_start_ms <= p.end_date.toMillis()
    )?.start_date.toMillis();
    const active_start_ms = is_ee ? 0 : home_period_start_ms ?? raw_budget_start_ms;
    const active_end_ms = b.is_ongoing ? null : b.end_date.toMillis();
    if (is_ee) {
      any_ee_id = any_ee_id ?? b.id;
      if (b.period === "monthly") monthly_ee_id = b.id;
    } else {
      real_budgets.push({
        id: b.id,
        category_ids: b.category_ids,
        start_ms: active_start_ms,
        end_ms: active_end_ms,
        is_ongoing: b.is_ongoing,
        cadence: to_cadence(b.period),
      });
    }
    // Prefer the materialized monthly periods (they carry per-period edits +
    // rollover). If none exist yet (a brand-new budget), SYNTHESIZE them from
    // the budget's `amount` so the limit shows instantly — no wait for the
    // generation cascade.
    const materialized = monthly_by_budget.get(b.id) ?? [];
    const monthly_periods: MonthlyPeriodForDerivation[] =
      materialized.length > 0
        ? materialized
        : monthly_source_periods.map((sp) => {
          const amt = monthly_equivalent_amount(b.amount, b.period);
          return {
            allocated_amount: amt,
            effective_amount: amt,
            start_ms: sp.start_ms,
            end_ms: sp.end_ms,
          };
        });
    budgets.push({
      id: b.id,
      name: b.name,
      is_ee,
      monthly_periods,
      active_start_ms,
      active_end_ms,
    });
  }

  // 3. The window's transactions (the per-window query's inclusive date range, re-filtered
  // from the raw load in its original order).
  const txns = raw.txns.filter((t) => {
    const d = t.data.transactionDate as Timestamp;
    return ts_cmp(d, span_start_ms) >= 0 && ts_cmp(d, span_end_ms) <= 0;
  });

  // 3a. Matched-pair INTERNAL-transfer detection. `TRANSFER_*` alone is ambiguous —
  // Plaid tags both own-account transfers AND external ACH bills (mortgage, subs)
  // as TRANSFER_OUT_ACCOUNT_TRANSFER. A transfer is INTERNAL only when it pairs with
  // an opposite transfer of the same amount on ANOTHER account within a few days;
  // unpaired transfers are EXTERNAL (real spending/bills) and are NOT excluded.
  const { internal_ids, internal_plaid_ids } = detect_internal_transfers_from_txns(txns);
  // A recurring stream is an internal transfer when any of its transactions are.
  const is_internal_stream = (transaction_ids: string[] | undefined): boolean =>
    (transaction_ids ?? []).some((t) => internal_plaid_ids.has(t));

  const recurring: RecurringForDerivation[] = [];
  const payments_by_id = new Map<string, ActualPayment[]>();
  // Included bills' Plaid `transactionIds` → map built AFTER the loop (conflict-safe).
  // Lets a bill's payments be attributed DETERMINISTICALLY from Plaid's own stream, not
  // only the sparse `split.outflowId` link — the fix for "paid bills read unpaid".
  const outflow_stream_items: Array<{ id: string; transaction_ids: string[] }> = [];
  for (const o of outflows) {
    if (!o.is_active || o.is_hidden) continue; // hidden = classified internal transfer
    // Skip only INTERNAL account transfers; external ACH bills (mortgage, etc.) stay.
    if (is_transfer_category(o.plaid_detailed_category) && is_internal_stream(o.transaction_ids)) {
      continue;
    }
    recurring.push({
      id: o.id,
      kind: "outflow",
      name: o.user_custom_name || o.merchant_name || o.description || "Bill",
      schedule: {
        frequency: o.frequency,
        // User override ("this + future") wins over Plaid's average when set.
        average_amount: o.expected_amount_override ?? o.average_amount,
        first_date: o.first_date,
        last_date: o.last_date,
        predicted_next_date: o.predicted_next_date,
      },
      payments: [],
      // User remove/pause spans — filtered per period on read (not a blanket skip,
      // so past periods still show a going-forward/paused bill).
      removal_intervals: o.removal_intervals,
    });
    payments_by_id.set(o.id, []);
    outflow_stream_items.push({ id: o.id, transaction_ids: o.transaction_ids ?? [] });
  }
  // Income is reconciled DETERMINISTICALLY off Plaid's own stream `transaction_ids`
  // (see Income-Tracking-Audit), not fuzzy merchant matching: map each stream
  // transaction (Plaid id) → its inflow, then attribute payments below. Transfer
  // streams are NOT income — skip them so they never appear as expected income.
  const inflow_stream_items: Array<{ id: string; transaction_ids: string[] }> = [];
  for (const i of inflows) {
    if (!i.is_active || i.is_hidden) continue; // hidden = classified internal transfer
    // Skip only INTERNAL account transfers; external inbound transfers stay.
    if (is_transfer_category(i.plaid_detailed_category) && is_internal_stream(i.transaction_ids)) {
      continue;
    }
    recurring.push({
      id: i.id,
      kind: "inflow",
      name: i.user_custom_name || i.payer_name || i.description || "Income",
      schedule: {
        frequency: i.frequency,
        // User override ("this + future") wins over Plaid's average when set.
        average_amount: i.expected_amount_override ?? i.average_amount,
        first_date: i.first_date,
        last_date: i.last_date,
        predicted_next_date: i.predicted_next_date,
      },
      payments: [],
      // When set, the override wins over per-slot auto-estimates in derive_period.
      has_amount_override: i.expected_amount_override != null,
      // Per-occurrence expected overrides (keyed by due-date) — win over everything for that occ.
      occurrence_amount_overrides: i.occurrence_amount_overrides,
      // Income remove/pause spans — filtered per period on read, same as bills.
      removal_intervals: i.removal_intervals,
    });
    payments_by_id.set(i.id, []);
    inflow_stream_items.push({ id: i.id, transaction_ids: i.transaction_ids ?? [] });
  }

  // Authoritative bill/income links from Plaid stream `transactionIds`. A txn claimed by
  // TWO streams is EXCLUDED (no arbitrary guess — see build_stream_membership_map).
  const outflow_tx_to_id = build_stream_membership_map(outflow_stream_items);
  const inflow_tx_to_id = build_stream_membership_map(inflow_stream_items);

  // 4. ONE pass over the window's transactions → split-match inputs + per-item payments.
  const splits_for_match: SplitForOnReadMatch[] = [];
  // Real INCOME_* credits in the window NOT tied to any recurring inflow → "Other income
  // received" (off-cycle paychecks, bonuses, contractor/gig), so real income is never hidden.
  const other_income_credits: DepositForSlot[] = [];
  for (const { id, data } of txns) {
    const txn_date_ms = (data.transactionDate as Timestamp).toMillis();
    const is_pending = data.isPending === true;
    // Only INTERNAL (matched-pair) transfers are excluded from spend; external ACH
    // payments keep counting.
    const txn_is_internal_transfer = internal_ids.has(id);
    const txn_is_income = data.type === "income";
    // Is this transaction part of a Plaid income stream? (Plaid id → inflow.)
    const plaid_txn_id = (data.transactionId as string | null) ?? null;
    const linked_inflow_id = plaid_txn_id ? inflow_tx_to_id.get(plaid_txn_id) : undefined;
    const raw = (data.splits as Array<Record<string, unknown>>) ?? [];
    // A manual "remove from bill" beats Plaid stream membership: the txn is neither a bill
    // payment nor excluded from budget spend as a recurring member.
    const linked_outflow_id =
      plaid_txn_id && !is_txn_detached_from_outflow(raw)
        ? outflow_tx_to_id.get(plaid_txn_id)
        : undefined;
    let income_amount = 0;
    for (const s of raw) {
      const outflow_id = (s.outflowId as string | null) ?? null;
      const inflow_id = (s.inflowId as string | null) ?? null;
      const amount = (s.amount as number) ?? 0;
      const split_id = (s.splitId as string) ?? (s.id as string) ?? null;
      // Excluded from spend only when it's an INTERNAL account transfer (matched
      // pair). External ACH payments tagged TRANSFER_* stay countable.
      splits_for_match.push(
        map_raw_split_to_on_read_match(s, {
          txn_date_ms,
          is_pending,
          is_transfer: txn_is_internal_transfer,
          is_income: txn_is_income,
          // Txn belongs to a recurring bill/income Plaid stream → not discretionary spend,
          // so it never counts toward a budget even if its split link was never set (S5).
          is_recurring_member: !!(linked_outflow_id || linked_inflow_id),
        })
      );
      income_amount += Math.abs(amount);
      // Outflow (bills) attribute via the split's stored link; MANUAL inflows via
      // split.inflowId — but a Plaid income txn is attributed ONCE below via
      // transaction_ids (skip its split link here to avoid double-counting).
      const link = outflow_id ?? (linked_inflow_id ? null : inflow_id);
      if (link && payments_by_id.has(link)) {
        payments_by_id.get(link)!.push({
          transaction_id: id,
          split_id,
          date_ms: txn_date_ms,
          amount: Math.abs(amount),
        });
      }
    }
    // Deterministic Plaid income reconciliation: this txn belongs to an inflow
    // stream → it's a received payment for that inflow (its full deposit amount).
    if (linked_inflow_id && payments_by_id.has(linked_inflow_id)) {
      payments_by_id.get(linked_inflow_id)!.push({
        transaction_id: id,
        split_id: null,
        date_ms: txn_date_ms,
        amount: income_amount,
      });
    }
    // Deterministic Plaid BILL reconciliation (mirror of income): this txn belongs to
    // an outflow's recurring stream → it's a payment for that bill. Only when NO split
    // already links this txn to a bill (the split link is precise + wins), so we never
    // double-count. Covers historical/unlinked payments whose `split.outflowId` was
    // never set — the root cause of paid bills reading unpaid on read.
    if (linked_outflow_id && payments_by_id.has(linked_outflow_id)) {
      const any_split_outflow_linked = raw.some(
        (s) => ((s.outflowId as string | null) ?? null) !== null
      );
      if (!any_split_outflow_linked) {
        payments_by_id.get(linked_outflow_id)!.push({
          transaction_id: id,
          split_id: null,
          date_ms: txn_date_ms,
          amount: income_amount, // sum of |split amounts| = the full txn amount
        });
      }
    }
    // "Other income received": a real INCOME_* credit not part of any recurring inflow
    // (no Plaid-stream link AND no split.inflowId). INCOME_* naturally excludes internal
    // transfers (TRANSFER_*) + most refunds.
    const txn_cat =
      (data.plaidDetailedCategory as string | null) ??
      (raw[0]?.plaidDetailedCategory as string | null) ??
      "";
    const any_split_inflow_linked = raw.some(
      (s) => ((s.inflowId as string | null) ?? null) !== null
    );
    if (
      txn_cat.startsWith("INCOME") &&
      !linked_inflow_id &&
      !any_split_inflow_linked &&
      !txn_is_internal_transfer
    ) {
      other_income_credits.push({ date_ms: txn_date_ms, amount: income_amount });
    }
  }
  for (const r of recurring) {
    r.payments = payments_by_id.get(r.id) ?? [];
  }

  // INCOME per-slot amounts: each inflow's HISTORICAL linked deposits (its whole Plaid stream,
  // not just the in-window ones) so a semi-monthly stream's mid vs end occurrences can each show
  // their own slot's recent average instead of the blended stream average. The docs were loaded
  // (for a superset of stream ids) in `load_period_derivation_raw`; attribute them via this
  // window's membership map exactly as the per-window query did.
  if (inflow_tx_to_id.size > 0) {
    const history_by_inflow = new Map<string, DepositForSlot[]>();
    for (const d of raw.inflow_history_docs) {
      const inflow_id = inflow_tx_to_id.get(d.transactionId as string);
      if (!inflow_id) continue;
      const splits = (d.splits as Array<{ amount?: number }>) ?? [];
      const amount = Math.abs(
        splits.reduce((s, sp) => s + (sp.amount ?? 0), 0) || (d.amount as number) || 0
      );
      const date_ms = (d.transactionDate as Timestamp).toMillis();
      const list = history_by_inflow.get(inflow_id) ?? [];
      list.push({ date_ms, amount });
      history_by_inflow.set(inflow_id, list);
    }
    for (const r of recurring) {
      if (r.kind === "inflow") r.payment_history = history_by_inflow.get(r.id) ?? [];
    }
  }

  // Emit only ONE Everything-Else budget (the monthly home). Today's data has a
  // per-cadence EE (monthly/weekly/bi_monthly) that each derive the same
  // unmatched total on read — showing all three is redundant. Keep the monthly
  // EE (fall back to any EE).
  const canonical_ee_id = monthly_ee_id ?? any_ee_id;
  const budgets_out = budgets.filter((b) => !b.is_ee || b.id === canonical_ee_id);

  return {
    view_buckets,
    placement_buckets,
    budgets: budgets_out,
    real_budgets,
    monthly_ee_id,
    any_ee_id,
    splits_for_match,
    recurring,
    goals,
    other_income_credits,
    span_start_ms,
    span_end_ms,
  };
}

/**
 * Load + shape for a SINGLE window — the `derive_period` path. Identical output to deriving any
 * window of a multi-window load (see `derive_period_range`).
 */
export async function resolve_period_derivation_deps(
  ctx: TraceContext,
  user_id: string,
  view_cadence: PeriodInstanceType,
  window_start_ms: number,
  window_end_ms: number
): Promise<PeriodDerivationDeps> {
  const raw = await load_period_derivation_raw(ctx, user_id, view_cadence, [
    { start_ms: window_start_ms, end_ms: window_end_ms },
  ]);
  return shape_period_derivation_deps(raw, view_cadence, window_start_ms, window_end_ms);
}
