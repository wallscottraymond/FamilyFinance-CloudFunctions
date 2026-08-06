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
} from "../../repositories";
import { budget_period_repo } from "../../repositories/budget_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
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
import { RecurringScheduleForGeneration } from "../../domain/outflows/outflow_period.service";
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

export interface BudgetForDerivation {
  id: string;
  name: string;
  is_ee: boolean;
  monthly_periods: MonthlyPeriodForDerivation[];
}

export interface RecurringForDerivation {
  id: string;
  name: string;
  kind: "outflow" | "inflow";
  schedule: RecurringScheduleForGeneration;
  payments: ActualPayment[];
}

export interface PeriodDerivationDeps {
  view_buckets: ViewBucket[];
  placement_buckets: PlacementBucket[];
  budgets: BudgetForDerivation[];
  real_budgets: BudgetForMatch[];
  monthly_ee_id: string | null;
  any_ee_id: string | null;
  splits_for_match: SplitForOnReadMatch[];
  recurring: RecurringForDerivation[];
  span_start_ms: number;
  span_end_ms: number;
}

export async function resolve_period_derivation_deps(
  ctx: TraceContext,
  user_id: string,
  view_cadence: PeriodInstanceType,
  window_start_ms: number,
  window_end_ms: number
): Promise<PeriodDerivationDeps> {
  // 1. Fetch everything that only needs user_id + the requested window in ONE
  // parallel round-trip. Only the transaction read depends on the derived period
  // span (computed below), so it alone follows — 2 IO layers instead of 4.
  const [overlapping, budget_entities, monthly_period_docs, outflows, inflows] =
    await Promise.all([
      source_period_repo.get_overlapping(
        ctx,
        Timestamp.fromMillis(window_start_ms),
        Timestamp.fromMillis(window_end_ms)
      ),
      budget_repo.get_by_user_id(ctx, user_id),
      budget_period_repo.get_by_user_and_type(ctx, user_id, "monthly"),
      outflow_repo.get_by_user_id(ctx, user_id),
      inflow_repo.get_by_user_id(ctx, user_id),
    ]);

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
    if (is_ee) {
      any_ee_id = any_ee_id ?? b.id;
      if (b.period === "monthly") monthly_ee_id = b.id;
    } else {
      real_budgets.push({
        id: b.id,
        category_ids: b.category_ids,
        start_ms: b.start_date.toMillis(),
        end_ms: b.is_ongoing ? null : b.end_date.toMillis(),
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
    budgets.push({ id: b.id, name: b.name, is_ee, monthly_periods });
  }

  // 3. Load the window's transactions (needs the period span derived above).
  const txns = await transaction_repo.get_active_in_date_range(
    ctx,
    user_id,
    span_start_ms,
    span_end_ms
  );

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
        average_amount: o.average_amount,
        first_date: o.first_date,
        last_date: o.last_date,
        predicted_next_date: o.predicted_next_date,
      },
      payments: [],
    });
    payments_by_id.set(o.id, []);
  }
  // Income is reconciled DETERMINISTICALLY off Plaid's own stream `transaction_ids`
  // (see Income-Tracking-Audit), not fuzzy merchant matching: map each stream
  // transaction (Plaid id) → its inflow, then attribute payments below. Transfer
  // streams are NOT income — skip them so they never appear as expected income.
  const inflow_tx_to_id = new Map<string, string>();
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
        average_amount: i.average_amount,
        first_date: i.first_date,
        last_date: i.last_date,
        predicted_next_date: i.predicted_next_date,
      },
      payments: [],
    });
    payments_by_id.set(i.id, []);
    for (const tx_id of i.transaction_ids ?? []) {
      inflow_tx_to_id.set(tx_id, i.id);
    }
  }

  // 4. ONE pass over the window's transactions → split-match inputs + per-item payments.
  const splits_for_match: SplitForOnReadMatch[] = [];
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
    let income_amount = 0;
    const raw = (data.splits as Array<Record<string, unknown>>) ?? [];
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
  }
  for (const r of recurring) {
    r.payments = payments_by_id.get(r.id) ?? [];
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
    span_start_ms,
    span_end_ms,
  };
}
