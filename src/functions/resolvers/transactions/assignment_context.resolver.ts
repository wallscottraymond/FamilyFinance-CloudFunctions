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

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { budget_repo } from "../../repositories/budget.repo";
import { source_period_repo } from "../../repositories/source_period.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { category_repo } from "../../repositories/category.repo";
import { outflow_repo } from "../../repositories/outflow.repo";
import { inflow_repo } from "../../repositories/inflow.repo";
import { build_stream_membership_map } from "../../domain/recurring/stream_membership";
import {
  BudgetForMatch,
  PeriodLens,
} from "../../domain/transactions/match_budget.service";
import { budget_cadence_to_instance } from "../../domain/budgets";
import { CategoryRule } from "../../domain/transactions/match_category.service";
import { SourcePeriodForMatch } from "../../domain/transactions/match_source_periods.service";
import {
  SplitForAssignment,
  AssignmentContext,
} from "../../domain/transactions/compute_transaction_assignment.service";
import { resolve_recurring_matches } from "./recurring_matches.resolver";

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
  category_rules: CategoryRule[];
  /** plaidDetailed (= category doc id) → the two app-category slugs. */
  category_slugs_by_plaid: Record<
    string,
    { overall_category_id: string | null; first_category_id: string | null }
  >;
  /** Plaid stream transaction id → recurring id, from active defs' `transactionIds`.
   *  The AUTHORITATIVE bill/income link (Plaid's own recurring stream), used to
   *  deterministically set a split's `outflow_id`/`inflow_id` — the fuzzy period
   *  matcher (empty-merchant bills, missing periods) misses these (S1 root cause). */
  outflow_tx_to_id: Map<string, string>;
  inflow_tx_to_id: Map<string, string>;
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
  const [budgets, category_docs, outflows, inflows] = await Promise.all([
    budget_repo.get_by_user_id(ctx, user_id),
    category_repo.get_active_cached(ctx),
    outflow_repo.get_by_user_id(ctx, user_id),
    inflow_repo.get_by_user_id(ctx, user_id),
  ]);

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

  // Real budgets (+ the Everything Else id PER LENS for the structural fallback).
  // A budget's period maps to exactly one lens (weekly/monthly/bi_monthly); the
  // three EE budgets are keyed by their own lens.
  const real_budgets: BudgetForMatch[] = [];
  const budget_names: Record<string, string> = {};
  const everything_else_budget_ids: Record<PeriodLens, string | null> = {
    monthly: null,
    weekly: null,
    bi_monthly: null,
  };
  for (const b of budgets) {
    budget_names[b.id] = b.name;
    const cadence = budget_cadence_to_instance(b.period);
    if (b.is_system_everything_else) {
      // The EE budget's `period` IS its lens (new EE budgets set period = lens;
      // the legacy single EE has period 'monthly').
      if (!everything_else_budget_ids[cadence]) {
        everything_else_budget_ids[cadence] = b.id;
      }
      continue;
    }
    const end_ts = b.budget_end_date ?? b.end_date;
    real_budgets.push({
      id: b.id,
      category_ids: b.category_ids,
      start_ms: b.start_date.toMillis(),
      end_ms: b.is_ongoing ? null : end_ts.toMillis(),
      is_ongoing: b.is_ongoing,
      cadence,
    });
  }

  // Category rules (merchants / keywords). The category DOC ID (= the detailed
  // Plaid enum) is the match vocabulary, so a merchant/keyword upgrade yields a
  // value that matches a budget's `categoryIds`.
  const category_rules: CategoryRule[] = category_docs.map(({ id, data: c }) => ({
    category: id,
    merchants: (c.merchants as string[]) ?? [],
    keywords: (c.keywords as string[]) ?? [],
  }));

  // App-category slug lookup: the category DOC ID is the Plaid detailed, so this
  // maps a split's resolved Plaid detailed → its two user-facing category slugs
  // (Simplified-Transaction-Categories). Built once per user, reused per txn.
  const category_slugs_by_plaid: Record<
    string,
    { overall_category_id: string | null; first_category_id: string | null }
  > = {};
  for (const { id, data: c } of category_docs) {
    category_slugs_by_plaid[id] = {
      overall_category_id: (c.overallCategoryId as string | null) ?? null,
      first_category_id: (c.firstCategoryId as string | null) ?? null,
    };
  }

  return {
    real_budgets,
    budget_names,
    everything_else_budget_ids,
    category_rules,
    category_slugs_by_plaid,
    outflow_tx_to_id,
    inflow_tx_to_id,
  };
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
  shared?: SharedAssignmentContext
): Promise<ResolvedAssignment | null> {
  const span = create_span(ctx, "resolver", "resolve_assignment_context");
  log_operation_start(span, user_id);

  const txn = await transaction_repo.get_raw_by_id(ctx, transaction_id);
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
  const [periods, recurring_by_split] = await Promise.all([
    source_period_repo.get_overlapping(ctx, anchor, anchor),
    resolve_recurring_matches(
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
      }
    ),
  ]);

  const {
    real_budgets,
    budget_names,
    everything_else_budget_ids,
    category_rules,
    category_slugs_by_plaid,
  } = resolved_shared;

  // Source periods overlapping the transaction date.
  const source_periods: SourcePeriodForMatch[] = periods.map((p) => ({
    id: p.id,
    type: p.period_type,
    start_ms: p.start_date.toMillis(),
    end_ms: p.end_date.toMillis(),
  }));

  // The engine matches budgets on the DETAILED Plaid category: category doc ids
  // ARE the detailed enums, budgets store them in `categoryIds`, and splits
  // carry the same enum in `plaidDetailedCategory`. We feed that detailed enum
  // into the engine's `*_match_category` fields (the matching vocabulary).
  // `internalDetailedCategory` is the user override; falls back to the Plaid
  // detailed enum.
  const splits_input: SplitForAssignment[] = raw_splits.map((s) => ({
    split_id: s.splitId as string,
    budget_id: (s.budgetId as string) ?? "unassigned",
    budget_assignment_source:
      (s.budgetAssignmentSource as "category" | "manual") ?? "category",
    // Prior per-lens assignments (for the touched-set + skip-if-unchanged). Fall
    // back to the legacy monthly `budgetId` for pre-migration docs.
    monthly_budget_id: (s.monthlyBudgetId as string | undefined) ?? undefined,
    weekly_budget_id: (s.weeklyBudgetId as string | undefined) ?? undefined,
    bi_weekly_budget_id: (s.biWeeklyBudgetId as string | undefined) ?? undefined,
    internal_match_category: (s.internalDetailedCategory as string | null) ?? null,
    plaid_match_category: (s.plaidDetailedCategory as string) ?? "OTHER_EXPENSE",
    outflow_id: (s.outflowId as string | null) ?? null,
    // Manual bill-pin source — preserved so a user's bill assignment survives re-sync.
    outflow_source: (s.outflowAssignmentSource as "auto" | "manual") ?? "auto",
    inflow_id: (s.inflowId as string | null) ?? null,
    monthly_period_id: (s.monthlyPeriodId as string | null) ?? null,
    weekly_period_id: (s.weeklyPeriodId as string | null) ?? null,
    bi_weekly_period_id: (s.biWeeklyPeriodId as string | null) ?? null,
    // App-category classification: prior slugs + source (preserved when "user").
    overall_category_id: (s.overallCategoryId as string | null) ?? null,
    first_category_id: (s.firstCategoryId as string | null) ?? null,
    second_category_id: (s.secondCategoryId as string | null) ?? null,
    category_source: (s.categorySource as "plaid" | "user") ?? "plaid",
  }));

  const context: AssignmentContext = {
    txn_date_ms,
    txn_merchant_name,
    txn_name: (data.name as string | null) ?? null,
    txn_is_income: txn_type === "income",
    real_budgets,
    everything_else_budget_ids,
    category_rules,
    category_slugs_by_plaid,
    source_periods,
    recurring_by_split,
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
