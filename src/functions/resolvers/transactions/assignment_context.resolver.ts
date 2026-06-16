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
import { BudgetForMatch } from "../../domain/transactions/match_budget.service";
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
  everything_else_budget_id: string | null;
  category_rules: CategoryRule[];
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
  const [budgets, category_docs] = await Promise.all([
    budget_repo.get_by_user_id(ctx, user_id),
    category_repo.get_active_cached(ctx),
  ]);

  // Real budgets (+ the Everything Else id for the structural fallback).
  const real_budgets: BudgetForMatch[] = [];
  const budget_names: Record<string, string> = {};
  let everything_else_budget_id: string | null = null;
  for (const b of budgets) {
    budget_names[b.id] = b.name;
    if (b.is_system_everything_else) {
      everything_else_budget_id = b.id;
      continue;
    }
    const end_ts = b.budget_end_date ?? b.end_date;
    real_budgets.push({
      id: b.id,
      category_ids: b.category_ids,
      start_ms: b.start_date.toMillis(),
      end_ms: b.is_ongoing ? null : end_ts.toMillis(),
      is_ongoing: b.is_ongoing,
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

  return {
    real_budgets,
    budget_names,
    everything_else_budget_id,
    category_rules,
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
  // resolve it now (single-item path). Run it concurrently with the two
  // transaction-DEPENDENT reads (source periods + recurring matches), which only
  // need data already in hand.
  const anchor = Timestamp.fromMillis(txn_date_ms);
  const [resolved_shared, periods, recurring_by_split] = await Promise.all([
    shared
      ? Promise.resolve(shared)
      : resolve_shared_assignment_context(ctx, user_id),
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
      }))
    ),
  ]);

  const {
    real_budgets,
    budget_names,
    everything_else_budget_id,
    category_rules,
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
    internal_match_category: (s.internalDetailedCategory as string | null) ?? null,
    plaid_match_category: (s.plaidDetailedCategory as string) ?? "OTHER_EXPENSE",
    outflow_id: (s.outflowId as string | null) ?? null,
    inflow_id: (s.inflowId as string | null) ?? null,
    monthly_period_id: (s.monthlyPeriodId as string | null) ?? null,
    weekly_period_id: (s.weeklyPeriodId as string | null) ?? null,
    bi_weekly_period_id: (s.biWeeklyPeriodId as string | null) ?? null,
  }));

  const context: AssignmentContext = {
    txn_date_ms,
    txn_merchant_name,
    txn_name: (data.name as string | null) ?? null,
    real_budgets,
    everything_else_budget_id,
    category_rules,
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
