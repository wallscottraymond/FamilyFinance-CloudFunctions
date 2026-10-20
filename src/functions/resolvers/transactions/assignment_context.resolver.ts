/**
 * Assignment Context Resolver
 *
 * READ-ONLY: loads everything the Transaction Assignment Engine needs to assign
 * one transaction's splits — the transaction, the user's real budgets (+ the
 * Everything Else id), the source periods overlapping the date, and the category
 * rules — and maps them to the pure core's input types.
 *
 * Recurring matches are NOT resolved here yet (owned by Recurring-Period-
 * Reconciliation); `recurring_by_split` is left empty until that ships.
 *
 * @module resolvers/transactions/assignment_context
 */

import { is_v2_record } from "../../domain/recurring/capture_rules";
import {
  ConvertedIndex,
  ConvertedRecordInput,
  build_converted_index,
} from "../../domain/recurring/converted_match.service";
import { vendor_key as vendor_key_of } from "../../domain/transactions/vendor_key.service";
import {
  budget_to_match_input,
  build_match_budgets,
} from "../../domain/budgets/match_budgets.service";
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { account_repo } from "../../repositories/account.repo";
import { user_repo } from "../../repositories/user.repo";
import { group_repo } from "../../repositories/sharing";
import { is_member } from "../../domain/sharing/group.service";
import { source_period_repo } from "../../repositories/source_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { category_repo } from "../../repositories/category.repo";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { feature_flag_repo } from "../../repositories/feature_flag.repo";
import { load_review_state_if_relevant } from "../recurring/review_holdout.resolver";
import { build_stream_membership_map } from "../../domain/recurring/stream_membership";
import { RemovalInterval } from "../../domain/recurring/recurring_suppression.service";
import {
  BillPaymentForRelease,
  bill_release_schedule,
  is_late_payment_candidate,
  is_payment_released,
} from "../../domain/recurring/late_payment.service";
import { is_edge_money, splits_paying_recurring } from "../../domain/recurring/stream_membership";
import { compute_countable_split_net } from "../../domain/recurring/period_reconciliation.service";
import type { RecurringScheduleForGeneration } from "../../domain/outflows/outflow_period.service";
import {
  BudgetForMatch,
  PeriodLens,
} from "../../domain/transactions/match_budget.service";
import { split_category_input_from_raw } from "../../domain/transactions/split_category_edit.service";
import {
  build_category_catalog,
  CategoryCatalog,
} from "../../domain/transactions/split_category.service";
import { SourcePeriodForMatch } from "../../domain/transactions/match_source_periods.service";
import {
  SplitForAssignment,
  AssignmentContext,
} from "../../domain/transactions/compute_transaction_assignment.service";
import {
  resolve_recurring_matches,
  PreloadedRecurringCandidates,
} from "./recurring_matches.resolver";

/** What the orchestrator needs back: the raw splits (for read-modify-write) + the pure input. */
export interface ResolvedAssignment {
  transaction_doc_id: string;
  /** Raw camelCase split maps, preserved so the write merges onto them. */
  raw_splits: Array<Record<string, unknown>>;
  splits_input: SplitForAssignment[];
  context: AssignmentContext;
  /** budget_id → name, so the engine can denormalize `budgetName` onto splits. */
  budget_names: Record<string, string>;
}

/**
 * The transaction-INDEPENDENT slice of the assignment context: a user's real
 * budgets, the Everything Else fallback id, budget id→name, and the category
 * rules. These depend only on `user_id`, so when assigning many of a user's
 * transactions they can be resolved ONCE and reused — avoiding the per-transaction
 * re-read of budgets and the categories collection (the main read amplification).
 */
export interface SharedAssignmentContext {
  real_budgets: BudgetForMatch[];
  budget_names: Record<string, string>;
  /** Everything Else budget id PER LENS (each period cadence has its own EE). */
  everything_else_budget_ids: Record<PeriodLens, string | null>;
  /** The ONE category function's catalog (canon M7). */
  category_catalog: CategoryCatalog;
  /** Plaid stream transaction id → recurring id, from active defs' `transactionIds`.
   *  The AUTHORITATIVE bill/income link (Plaid's own recurring stream), used to
   *  deterministically set a split's `outflow_id`/`inflow_id` — the fuzzy period
   *  matcher (empty-merchant bills, missing periods) misses these (S1 root cause). */
  outflow_tx_to_id: Map<string, string>;
  inflow_tx_to_id: Map<string, string>;
  /**
   * Account-Rooted-Sharing: an account the user shared with a group counts in THAT group's view
   * (from its share-from date), so its transactions are assigned against the GROUP's budgets —
   * the same rule `derive_period` uses on read. Without it, a shared account's transaction was
   * stored as the user's personal Everything Else while the group view counted it in the group's
   * budget (e.g. "Santo Taco" → Everything Else vs "Eating Out and Snacks"). Keyed by the
   * account's doc id AND Plaid id.
   */
  group_views_by_account: Map<
    string,
    { from_ms: number | null; group_id: string; view: ViewBudgets }
  >;
  /** Bill / income id → the view it belongs to (group id, or null = Me). */
  recurring_view_by_id: Map<string, string | null>;
  /** Active, non-hidden bills — a manual pin to anything else (deleted / hidden) is stale. */
  active_outflow_ids: Set<string>;
  /** The caller's OWN active, non-hidden incomes — a manual income pin to anything else is stale
   *  (never another user's income, whatever a client wrote). */
  active_inflow_ids?: Set<string>;
  /** Bill / income id → its remove / pause spans (only items that have any). A payment in a
   *  removed / paused month is released to budgets (`is_payment_released`). */
  removal_intervals_by_id: Map<string, RemovalInterval[]>;
  /** D31: a removed BILL's schedule — its late payment of the last occurrence before the cut-off
   *  is not released (`is_payment_released`). Only bills that have removal intervals. */
  release_schedule_by_id?: Map<string, RecurringScheduleForGeneration>;
  /** D37: a removed BILL's stored payments (its split-linked + Plaid-stream transactions, as
   *  stored reconcile reads them), loaded at most once per batch and only for a transaction that
   *  may be its late payment — the release rule keeps a late payment only while the occurrence it
   *  pays is still unpaid. */
  load_bill_payments_for_release?: (recurring_id: string) => Promise<BillPaymentForRelease[]>;
  /**
   * Plaid transaction ids held out of FUZZY bill / income matching (Convert-To-Recurring X3): the
   * payments of streams Plaid is unsure of (suggested, not saved) or the user said aren't a bill.
   * They stay normal transactions — never linked to an old bill by a merchant guess. Stream
   * membership and manual pins / detaches are unaffected. One read (the review state doc).
   */
  fuzzy_excluded_plaid_ids?: Set<string>;
  /**
   * v2 bills / income (captured under the new rules) → the account their payments come from.
   * The FUZZY scorer links a payment to one of these only from that same account (F13: a payment
   * from another account — the bill moved — is not auto-linked; stream membership, D1 and manual
   * pins are unaffected). Old records keep today's fuzzy matching (D13). No extra reads.
   */
  v2_account_by_recurring_id?: Map<string, string>;
  /**
   * Converted bills / income (v2 + manual + a vendor key on a Plaid account), keyed by direction |
   * account | vendor (Convert-To-Recurring Phase 2, D1): a payment of that vendor on that account
   * links to them by KEY, any amount; fuzzy matching excludes exactly these ids. No extra reads —
   * built from the bills / income this context already loads. Empty for anyone without such records.
   */
  converted_index?: ConvertedIndex;
  /** Plaid payment id → the converted bill / income that absorbed it. */
  outflow_absorbed_tx_to_id?: Map<string, string>;
  inflow_absorbed_tx_to_id?: Map<string, string>;
}

/** One view's budgets, as the engine matches against them. */
export interface ViewBudgets {
  real_budgets: BudgetForMatch[];
  budget_names: Record<string, string>;
  everything_else_budget_ids: Record<PeriodLens, string | null>;
}

/**
 * Resolve the transaction-independent shared context for a user (budgets +
 * categories). Loaded once per batch; pass into `resolve_assignment_context` to
 * skip the per-transaction re-reads.
 */
export async function resolve_shared_assignment_context(
  ctx: TraceContext,
  user_id: string
): Promise<SharedAssignmentContext> {
  // Budgets (per-user) and category rules (cached reference data) are
  // independent — fetch concurrently.
  // The flag check (cached per instance) runs alongside the reads; the review state doc is read
  // only for a flag-on user or one with v2 records (X11: no extra read for anyone else).
  const flag_on = feature_flag_repo.is_convert_to_recurring_enabled(user_id);
  const [budgets, category_docs, outflows, inflows] = await Promise.all([
    budget_repo.get_by_user_id(ctx, user_id),
    category_repo.get_active_cached(ctx),
    outflow_repo.get_by_user_id(ctx, user_id),
    inflow_repo.get_by_user_id(ctx, user_id),
  ]);
  const review_state = await load_review_state_if_relevant(ctx, user_id, [...outflows, ...inflows], flag_on);

  // Authoritative recurring-stream links: Plaid stream `transactionIds` → recurring id.
  // Only ACTIVE, non-hidden defs (hidden = classified internal transfer) contribute, so
  // a txn is linked to a bill/income exactly as the derive-on-read read path does. A txn
  // claimed by two streams is excluded (no guessing — see build_stream_membership_map).
  const outflow_tx_to_id = build_stream_membership_map(
    outflows.filter((o) => o.is_active && !o.is_hidden)
  );
  const inflow_tx_to_id = build_stream_membership_map(
    inflows.filter((i) => i.is_active && !i.is_hidden)
  );

  // The `categories` collection as the one category function needs it (canon M7).
  const category_catalog = build_category_catalog(category_docs);
  // Real budgets (+ the Everything Else id PER LENS for the structural fallback).
  const { real_budgets, budget_names, everything_else_budget_ids } = build_view_budgets(budgets);
  const group_views_by_account = await resolve_group_views(ctx, user_id);

  // Which VIEW each bill / income belongs to (Account-Rooted-Sharing): a group's when its account
  // is shared with one, else Me (null). A transaction links only to bills in ITS view — the
  // period page drops a link to another view's bill and counts the money as ordinary spending.
  const recurring_view_by_id = new Map<string, string | null>();
  for (const r of [...outflows, ...inflows]) {
    recurring_view_by_id.set(r.id, group_views_by_account.get(r.account_id ?? "")?.group_id ?? null);
  }
  const active_outflow_ids = new Set(outflows.filter((o) => o.is_active && !o.is_hidden).map((o) => o.id));
  const active_inflow_ids = new Set(inflows.filter((i) => i.is_active && !i.is_hidden).map((i) => i.id));
  const removal_intervals_by_id = new Map<string, RemovalInterval[]>();
  for (const r of [...outflows, ...inflows]) {
    if (r.removal_intervals?.length) removal_intervals_by_id.set(r.id, r.removal_intervals);
  }
  const release_schedule_by_id = new Map<string, RecurringScheduleForGeneration>();
  for (const o of outflows) {
    if (o.removal_intervals?.length) release_schedule_by_id.set(o.id, bill_release_schedule(o));
  }
  const bill_payments_memo = new Map<string, Promise<BillPaymentForRelease[]>>();
  const load_bill_payments_for_release = (recurring_id: string): Promise<BillPaymentForRelease[]> => {
    const hit = bill_payments_memo.get(recurring_id);
    if (hit) return hit;
    const o = outflows.find((x) => x.id === recurring_id);
    const p = load_bill_payments(ctx, user_id, recurring_id, o?.transaction_ids ?? []);
    bill_payments_memo.set(recurring_id, p);
    return p;
  };
  const v2_account_by_recurring_id = new Map<string, string>();
  for (const r of [...outflows, ...inflows]) {
    if (is_v2_record(r) && r.account_id) v2_account_by_recurring_id.set(r.id, r.account_id);
  }

  // Payments of streams a converted bill absorbed (D42): their own map, judged by the D1 floors.
  const absorbed_of = (list: Array<{ id: string; is_active: boolean; is_hidden: boolean; absorbed_txn_ids?: string[] }>) =>
    build_stream_membership_map(
      list.filter((r) => r.is_active && !r.is_hidden && r.absorbed_txn_ids?.length)
        .map((r) => ({ id: r.id, transaction_ids: r.absorbed_txn_ids }))
    );
  const converted_index = build_converted_index([
    ...outflows.map((o) => as_converted_input(o, "outflow")),
    ...inflows.map((i) => as_converted_input(i, "inflow")),
  ]);

  return {
    real_budgets,
    budget_names,
    everything_else_budget_ids,
    category_catalog,
    outflow_tx_to_id,
    inflow_tx_to_id,
    group_views_by_account,
    recurring_view_by_id,
    active_outflow_ids,
    active_inflow_ids,
    removal_intervals_by_id,
    release_schedule_by_id,
    load_bill_payments_for_release,
    fuzzy_excluded_plaid_ids: new Set(review_state?.suppressed_txn_ids ?? []),
    v2_account_by_recurring_id,
    converted_index,
    outflow_absorbed_tx_to_id: absorbed_of(outflows),
    inflow_absorbed_tx_to_id: absorbed_of(inflows),
  };
}

function as_converted_input(
  r: {
    id: string; is_active: boolean; is_hidden: boolean; merged_into_id?: string | null;
    capture_rules_version?: number | null; source?: string | null; vendor_key?: string | null;
    account_id?: string | null; average_amount: number; expected_amount_override?: number | null;
    first_date?: Timestamp; converted_at_ms?: number | null; retro_txn_ids?: string[];
  },
  direction: "outflow" | "inflow"
): ConvertedRecordInput {
  return {
    id: r.id,
    direction,
    is_active: r.is_active,
    is_hidden: r.is_hidden,
    merged_into_id: r.merged_into_id,
    capture_rules_version: r.capture_rules_version,
    source: r.source,
    vendor_key: r.vendor_key,
    account_id: r.account_id,
    average_amount: r.average_amount,
    expected_amount_override: r.expected_amount_override,
    first_date_ms: (r.first_date as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0,
    converted_at_ms: r.converted_at_ms,
    retro_txn_ids: r.retro_txn_ids,
  };
}

/** The transaction's vendor key: the stored one, else computed exactly as the stored one is. */
function txn_vendor_key(data: Record<string, unknown>): string | null {
  const stored = data.vendorKey;
  if (typeof stored === "string" && stored.length > 0) return stored;
  return vendor_key_of({
    merchant_name: data.merchantName as string | null | undefined,
    name: data.name as string | null | undefined,
    description: data.description as string | null | undefined,
  });
}

/**
 * D37: a bill's stored payments — the transactions linked to it by split (`splitOutflowIds`) plus
 * its Plaid stream's, each the net of the splits paying it (stored reconcile's sources and rule).
 */
async function load_bill_payments(
  ctx: TraceContext,
  user_id: string,
  recurring_id: string,
  stream_plaid_ids: string[]
): Promise<BillPaymentForRelease[]> {
  const [link_txns, stream_txns] = await Promise.all([
    transaction_repo.get_by_split_recurring_link(ctx, user_id, "outflow", recurring_id),
    transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, stream_plaid_ids),
  ]);
  const stream_ids = new Set(stream_txns.map((t) => t.id));
  const seen = new Set<string>();
  const out: BillPaymentForRelease[] = [];
  for (const t of [...link_txns, ...stream_txns]) {
    if (!t.id || seen.has(t.id) || t.isActive === false) continue;
    seen.add(t.id);
    const paying = is_edge_money((t as { transferRole?: unknown }).transferRole)
      ? []
      : splits_paying_recurring(t.splits ?? [], "outflow", recurring_id, stream_ids.has(t.id));
    if (paying.length === 0) continue;
    out.push({
      id: t.id,
      date_ms: (t.transactionDate as Timestamp | undefined)?.toMillis?.() ?? 0,
      amount: compute_countable_split_net(paying as Parameters<typeof compute_countable_split_net>[0], t.id).amount,
    });
  }
  return out;
}

/**
 * A view's budgets → what the engine matches: real budgets + the Everything Else id PER LENS.
 * A budget's period maps to exactly one lens; the three EE budgets are keyed by their own lens.
 */
function build_view_budgets(
  budgets: Awaited<ReturnType<typeof budget_repo.get_by_user_id>>
): ViewBudgets {
  // THE budget set (domain/budgets/match_budgets) — the period page builds the same one, so the
  // stored budget equals the counted one (canon A11): snapped start, `budget_end_date`, every
  // cadence owning its categories in every lens, one Everything Else per lens.
  const match = build_match_budgets(budgets.map(budget_to_match_input));
  return {
    real_budgets: match.real_budgets,
    budget_names: match.names,
    everything_else_budget_ids: match.everything_else_ids,
  };
}

/**
 * The user's accounts placed in a group they belong to → that group's budgets (by doc + Plaid
 * account id). Same membership rule as `resolve_derive_scope` (a stale placement counts in Me).
 * Empty — and no extra reads beyond the user doc — for someone in no groups.
 */
async function resolve_group_views(
  ctx: TraceContext,
  user_id: string
): Promise<Map<string, { from_ms: number | null; group_id: string; view: ViewBudgets }>> {
  const out = new Map<string, { from_ms: number | null; group_id: string; view: ViewBudgets }>();
  const user = await user_repo.get_by_id(ctx, user_id);
  const group_ids = (user?.data.groupIds as string[] | undefined) ?? [];
  if (group_ids.length === 0) return out;
  const [accounts, groups] = await Promise.all([
    account_repo.get_by_user_id(ctx, user_id),
    group_repo.get_many(ctx, group_ids),
  ]);
  const member_of = new Set(groups.filter((g) => is_member(g, user_id)).map((g) => g.id));
  const placed = accounts.filter((a) => a.placement && member_of.has(a.placement.group_id));
  if (placed.length === 0) return out;
  const views = new Map<string, ViewBudgets>();
  await Promise.all(
    [...new Set(placed.map((a) => a.placement!.group_id))].map(async (gid) => {
      views.set(gid, build_view_budgets(await budget_repo.get_by_user_id(ctx, `group:${gid}`)));
    })
  );
  for (const a of placed) {
    const view = views.get(a.placement!.group_id);
    if (!view) continue;
    const entry = {
      from_ms: a.placement!.shared_from_ms ?? null,
      group_id: a.placement!.group_id,
      view,
    };
    out.set(a.id, entry);
    if (a.account_id) out.set(a.account_id, entry);
  }
  return out;
}

/**
 * Resolve the assignment context for a transaction.
 *
 * @param shared - Optional pre-resolved shared context (budgets + categories).
 *   When provided (batch path), the per-transaction budget/category reads are
 *   skipped; only the transaction doc, its overlapping source periods, and its
 *   recurring matches are read.
 * @returns The resolved context, or null if the transaction is missing/inactive.
 */
export async function resolve_assignment_context(
  ctx: TraceContext,
  user_id: string,
  transaction_id: string,
  shared?: SharedAssignmentContext,
  preloaded_candidates?: PreloadedRecurringCandidates,
  // Batch path: the txn doc + the source periods overlapping the batch's date span, both read ONCE
  // for the whole batch. When present, the per-transaction `get_raw_by_id` + `get_overlapping`
  // reads are skipped (filtered in memory) — the remaining O(N)/sync reads this path eliminates.
  preloaded_txn?: { id: string; data: Record<string, unknown> },
  preloaded_source_periods?: SourcePeriodForMatch[]
): Promise<ResolvedAssignment | null> {
  const span = create_span(ctx, "resolver", "resolve_assignment_context");
  log_operation_start(span, user_id);

  const txn = preloaded_txn ?? (await transaction_repo.get_raw_by_id(ctx, transaction_id));
  if (!txn) {
    return null;
  }
  const data = txn.data;

  const txn_date_ms = (data.transactionDate as Timestamp).toMillis();
  const raw_splits = (data.splits as Array<Record<string, unknown>>) ?? [];
  const txn_merchant_name = (data.merchantName as string | null) ?? null;
  const txn_type = (data.type as string) ?? "expense";

  // Transaction-independent context: reuse the caller's shared slice (batch) or
  // resolve it now (single-item path). Resolve it FIRST because the recurring
  // matcher needs its authoritative stream maps; the two transaction-DEPENDENT
  // reads (source periods + recurring matches) then run concurrently.
  const anchor = Timestamp.fromMillis(txn_date_ms);
  const txn_plaid_id = (data.transactionId as string | null) ?? null;
  const resolved_shared =
    shared ?? (await resolve_shared_assignment_context(ctx, user_id));

  // Recurring matches (uses preloaded candidates on the batch path) run concurrently with the
  // source-period resolution below.
  const recurring_by_split_promise = resolve_recurring_matches(
    ctx,
    user_id,
    txn_type,
    txn_merchant_name,
    txn_date_ms,
    raw_splits.map((s) => ({
      split_id: s.splitId as string,
      amount: (s.amount as number) ?? 0,
    })),
    {
      txn_plaid_id,
      outflow_tx_to_id: resolved_shared.outflow_tx_to_id,
      inflow_tx_to_id: resolved_shared.inflow_tx_to_id,
      preloaded_candidates,
      fuzzy_excluded_plaid_ids: resolved_shared.fuzzy_excluded_plaid_ids,
      v2_account_by_recurring_id: resolved_shared.v2_account_by_recurring_id,
      txn_account_id: (data.accountId as string | null) ?? null,
      converted_index: resolved_shared.converted_index,
      txn_vendor_key: txn_vendor_key(data),
      txn_created_ms: (data.createdAt as Timestamp | undefined)?.toMillis?.() ?? null,
      absorbed_tx_to_id: txn_type === "income" ? resolved_shared.inflow_absorbed_tx_to_id : resolved_shared.outflow_absorbed_tx_to_id,
    }
  );

  // Source periods overlapping the transaction date. Batch path: filter the ONCE-preloaded set in
  // memory (no read). Single-item path: query the overlapping periods (`source_periods` is a
  // global calendar collection — a per-txn read here was O(N)/sync).
  const source_periods: SourcePeriodForMatch[] = preloaded_source_periods
    ? preloaded_source_periods.filter(
      (p) => p.start_ms <= txn_date_ms && txn_date_ms <= p.end_ms
    )
    : (await source_period_repo.get_overlapping(ctx, anchor, anchor)).map((p) => ({
      id: p.id,
      type: p.period_type,
      start_ms: p.start_date.toMillis(),
      end_ms: p.end_date.toMillis(),
    }));

  // Which view this transaction counts in: a shared account's group (from its share-from date
  // on), else the user's own budgets.
  const placed = resolved_shared.group_views_by_account.get((data.accountId as string) ?? "");
  const in_group = !!placed && (placed.from_ms === null || txn_date_ms >= placed.from_ms);
  const view: ViewBudgets = in_group ? placed!.view : resolved_shared;
  const view_group_id = in_group ? placed!.group_id : null;
  // …and a bill / income removed or paused for this payment's month isn't paid by it either: the
  // money counts as ordinary spending / money in (the period page applies the same rule).
  // A bill / income that no longer exists (deleted; a period of it left behind) is in no view.
  const of_view = (recurring_id: string): boolean =>
    resolved_shared.recurring_view_by_id.has(recurring_id) &&
    (resolved_shared.recurring_view_by_id.get(recurring_id) ?? null) === view_group_id;
  // D31 / D37: a bill's late payment of its last occurrence before the cut-off is not released
  // while that occurrence is still unpaid — judged by the bill's stored payments, loaded only for
  // a transaction that may be such a late payment.
  const release_payments = new Map<string, BillPaymentForRelease[]>();
  for (const [rid, schedule] of resolved_shared.release_schedule_by_id ?? []) {
    const intervals = resolved_shared.removal_intervals_by_id?.get(rid);
    if (!is_late_payment_candidate(intervals, txn_date_ms, schedule)) continue;
    release_payments.set(rid, (await resolved_shared.load_bill_payments_for_release?.(rid)) ?? []);
  }
  const released = (recurring_id: string): boolean => {
    const schedule = resolved_shared.release_schedule_by_id?.get(recurring_id);
    return is_payment_released(
      resolved_shared.removal_intervals_by_id?.get(recurring_id),
      { id: txn.id, date_ms: txn_date_ms },
      schedule ? { schedule, payments: release_payments.get(recurring_id) ?? [] } : null
    );
  };
  const in_view = (recurring_id: string | null): boolean =>
    !recurring_id || (of_view(recurring_id) && !released(recurring_id));

  // A link to a bill / income of ANOTHER view isn't this view's bill payment — the period page
  // drops it and counts the money here as ordinary spending; the engine does the same.
  // …except that a stream-member payment whose bill is another view's still pays an in-view
  // converted bill of its key (D1's `d1_alt`): the stream target is dropped, the D1 one is kept.
  const recurring_by_split = Object.fromEntries(
    Object.entries(await recurring_by_split_promise).map(([split_id, m]) => {
      const alt = m.d1_alt_id ?? null;
      const outflow_ok = in_view(m.outflow_id);
      const inflow_ok = in_view(m.inflow_id);
      const alt_ok = !!alt && in_view(alt);
      return [
        split_id,
        {
          outflow_id: outflow_ok ? m.outflow_id : (m.outflow_id && alt_ok && m.d1_alt_kind === "outflow" ? alt : null),
          inflow_id: inflow_ok ? m.inflow_id : (m.inflow_id && alt_ok && m.d1_alt_kind === "inflow" ? alt : null),
        },
      ];
    })
  );
  // Manual bill pins are honoured only for live bills in this view (a stale / other-view pin
  // falls back to auto — canon A5).
  const active_outflow_ids = new Set(
    [...resolved_shared.active_outflow_ids].filter((id) => in_view(id))
  );
  // …and a pin to a bill removed / paused for this month is PARKED, not dropped (Restore).
  const suppressed_outflow_ids = new Set(
    [...resolved_shared.active_outflow_ids].filter((id) => of_view(id) && released(id))
  );
  // The caller's own incomes in this view (a manual income pin elsewhere is dropped), and the ones
  // removed / paused for this month (kept as stored).
  const active_inflow_ids = new Set(
    [...(resolved_shared.active_inflow_ids ?? [])].filter((id) => in_view(id))
  );
  const suppressed_inflow_ids = new Set(
    [...(resolved_shared.active_inflow_ids ?? [])].filter((id) => of_view(id) && released(id))
  );
  const { real_budgets, budget_names, everything_else_budget_ids } = view;

  // The engine's inputs for the ONE category function (canon M7): the immutable Plaid code +
  // the user's pick (`categorySource: "user"` + slugs).
  const catalog = resolved_shared.category_catalog;
  const splits_input: SplitForAssignment[] = raw_splits.map((s) => {
    // The category inputs come from THE raw-split mapper every reader uses (an old reclassify in
    // the legacy fields reads as the user's pick, as the backfill will store it).
    const cat = split_category_input_from_raw(s, data, catalog);
    return {
      split_id: s.splitId as string,
      budget_id: (s.budgetId as string) ?? "unassigned",
      budget_assignment_source:
        (s.budgetAssignmentSource as "category" | "manual") ?? "category",
      // Prior per-lens assignments (for the touched-set + skip-if-unchanged). Fall
      // back to the legacy monthly `budgetId` for pre-migration docs.
      monthly_budget_id: (s.monthlyBudgetId as string | undefined) ?? undefined,
      weekly_budget_id: (s.weeklyBudgetId as string | undefined) ?? undefined,
      bi_weekly_budget_id: (s.biWeeklyBudgetId as string | undefined) ?? undefined,
      plaid_match_category: (s.plaidDetailedCategory as string) ?? "OTHER_EXPENSE",
      outflow_id: (s.outflowId as string | null) ?? null,
      // Manual bill-pin source — preserved so a user's bill assignment survives re-sync.
      outflow_source: (s.outflowAssignmentSource as "auto" | "manual") ?? "auto",
      suspended_outflow_pin: (s.suspendedOutflowPinId as string | null | undefined) ?? null,
      inflow_id: (s.inflowId as string | null) ?? null,
      inflow_source: (s.inflowAssignmentSource as "auto" | "manual" | undefined) ?? "auto",
      monthly_period_id: (s.monthlyPeriodId as string | null) ?? null,
      weekly_period_id: (s.weeklyPeriodId as string | null) ?? null,
      bi_weekly_period_id: (s.biWeeklyPeriodId as string | null) ?? null,
      // App-category classification: prior slugs + source (preserved when "user").
      overall_category_id: cat.overall_category_id ?? null,
      first_category_id: cat.first_category_id ?? null,
      second_category_id: cat.second_category_id ?? null,
      category_source: cat.category_source ?? "plaid",
    };
  });

  const context: AssignmentContext = {
    txn_date_ms,
    txn_merchant_name,
    txn_name: (data.name as string | null) ?? null,
    txn_is_income: txn_type === "income",
    txn_transfer_role: (data.transferRole as string | null | undefined) ?? null,
    real_budgets,
    everything_else_budget_ids,
    category_catalog: resolved_shared.category_catalog,
    source_periods,
    recurring_by_split,
    active_outflow_ids,
    suppressed_outflow_ids,
    active_inflow_ids,
    suppressed_inflow_ids,
  };

  log_operation_success(span, user_id);
  return {
    transaction_doc_id: transaction_id,
    raw_splits,
    splits_input,
    context,
    budget_names,
  };
}
