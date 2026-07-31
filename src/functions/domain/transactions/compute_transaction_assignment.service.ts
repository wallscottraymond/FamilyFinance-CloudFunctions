/**
 * Compute Transaction Assignment Domain Service
 *
 * The PURE heart of the Transaction Assignment Engine: given a transaction's
 * splits + the resolved context, sequence the matchers through the precedence
 * and return the new per-split assignment, the set of budgets touched
 * (before ∪ after — for the scoped fan-out), and whether anything changed
 * (for skip-if-unchanged).
 *
 * Precedence per split:  category → manual? → recurring → budget → source periods
 *
 * The recurring matchers (outflow/inflow) are owned by Recurring-Period-
 * Reconciliation; their per-split result is INJECTED via the context, so this
 * service stays pure and complete without them.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/compute_transaction_assignment
 */

import {
  match_budget,
  BudgetForMatch,
  PeriodLens,
  UNASSIGNED_BUDGET_ID,
} from "./match_budget.service";

/** The three period lenses, in a stable order. */
export const PERIOD_LENSES: PeriodLens[] = ["monthly", "weekly", "bi_monthly"];
import { match_category, CategoryRule } from "./match_category.service";
import {
  match_source_periods,
  SourcePeriodForMatch,
} from "./match_source_periods.service";

/** A split as it currently stands, with the fields the engine reads + owns. */
export interface SplitForAssignment {
  split_id: string;
  /** The manual-pin signal: when `budget_assignment_source === "manual"`, this is
   *  the globally-pinned budget id. Also the legacy single-budget field. */
  budget_id: string;
  budget_assignment_source: "category" | "manual";
  /** Prior per-lens assignments (for touched-set + skip-if-unchanged). Fall back
   *  to `budget_id` (monthly) for pre-migration docs that lack them. */
  monthly_budget_id?: string;
  weekly_budget_id?: string;
  bi_weekly_budget_id?: string;
  internal_match_category: string | null;
  plaid_match_category: string;
  outflow_id: string | null;
  inflow_id: string | null;
  monthly_period_id: string | null;
  weekly_period_id: string | null;
  bi_weekly_period_id: string | null;
  /** Prior app-category classification (for override-preservation + skip-if-unchanged).
   *  Optional: pre-migration splits lack them; `category_source` defaults to "plaid". */
  overall_category_id?: string | null;
  first_category_id?: string | null;
  /** SECONDARY-level override: the chosen category doc id (== Plaid detailed). Only
   *  meaningful when `category_source === "user"`; null = a first-only override. */
  second_category_id?: string | null;
  category_source?: "plaid" | "user";
}

/** Recurring match result for one split (produced by the recurring matchers). */
export interface RecurringMatch {
  outflow_id: string | null;
  inflow_id: string | null;
}

/** Everything the assembler needs, resolved once per transaction. */
export interface AssignmentContext {
  txn_date_ms: number;
  txn_merchant_name: string | null;
  txn_name: string | null;
  /** True for income transactions. Income NEVER auto-assigns to a budget (B1) —
   *  it stays unassigned unless the user manually pins it. */
  txn_is_income: boolean;
  /** All real budgets across every cadence; the engine filters per lens. */
  real_budgets: BudgetForMatch[];
  /** The Everything Else budget id PER LENS (null for a lens with no EE budget). */
  everything_else_budget_ids: Record<PeriodLens, string | null>;
  category_rules: CategoryRule[];
  /** plaidDetailed → the two app-category slugs, from the `categories` collection.
   *  Missing key → the split gets null slugs (unmapped Plaid detailed). */
  category_slugs_by_plaid: Record<
    string,
    { overall_category_id: string | null; first_category_id: string | null }
  >;
  source_periods: SourcePeriodForMatch[];
  /** Recurring match per split id (empty = no recurring match). */
  recurring_by_split: Record<string, RecurringMatch>;
}

/** The computed assignment for one split (the engine-owned fields only). */
export interface AssignedSplit {
  split_id: string;
  /** Per-lens budget assignment — the split is placed INDEPENDENTLY per cadence. */
  monthly_budget_id: string;
  weekly_budget_id: string;
  bi_weekly_budget_id: string;
  /** All three share the same source (global manual pin, else category). */
  budget_assignment_source: "category" | "manual";
  /** LEGACY alias = monthly_budget_id (kept until callers read the lens fields). */
  budget_id: string;
  outflow_id: string | null;
  inflow_id: string | null;
  monthly_period_id: string | null;
  weekly_period_id: string | null;
  bi_weekly_period_id: string | null;
  /** App-category classification (Simplified-Transaction-Categories): the two
   *  user-facing slugs + their source. `"user"` = a preserved manual override. */
  overall_category_id: string | null;
  first_category_id: string | null;
  /** The chosen SECONDARY category doc id — only set on a user override (else null). */
  second_category_id: string | null;
  category_source: "plaid" | "user";
  /** Why this assignment was made — for per-split decision logging (monthly lens). */
  reason: {
    budget: "category+date" | "everything_else_fallback" | "no_everything_else" | "manual" | "income_excluded";
    tie: boolean;
    recurring: "outflow" | "inflow" | "manual_detached" | "none";
  };
}

/** Result of assembling a transaction's assignment. */
export interface TransactionAssignmentResult {
  splits: AssignedSplit[];
  /** Budgets whose contribution may have changed (old ∪ new) — fan-out scope. */
  touched_budget_ids: string[];
  /** Recurring outflow docs whose period status may have changed (old ∪ new). */
  touched_outflow_ids: string[];
  /** Recurring inflow docs whose period status may have changed (old ∪ new). */
  touched_inflow_ids: string[];
  /** False → no engine-owned field changed (skip the write). */
  changed: boolean;
  /** True → a split has no Everything Else budget to fall to (missing-EE ERROR). */
  any_unassigned: boolean;
}

/**
 * Assemble the assignment for all of a transaction's splits.
 *
 * PURE FUNCTION.
 */
export function compute_transaction_assignment(
  splits: SplitForAssignment[],
  context: AssignmentContext
): TransactionAssignmentResult {
  // Source periods are transaction-level (one date) → compute once.
  const periods = match_source_periods(context.txn_date_ms, context.source_periods);

  const assigned: AssignedSplit[] = [];
  const touched = new Set<string>();
  const touched_outflow = new Set<string>();
  const touched_inflow = new Set<string>();
  let changed = false;
  let any_unassigned = false;

  for (const split of splits) {
    // Before-state: prior per-lens assignments (fall back to the legacy monthly
    // `budget_id` for pre-migration docs). Union of before ∪ after = fan-out scope.
    const before_monthly = split.monthly_budget_id ?? split.budget_id;
    const before_weekly = split.weekly_budget_id ?? split.budget_id;
    const before_bi_weekly = split.bi_weekly_budget_id ?? split.budget_id;
    touched.add(before_monthly);
    touched.add(before_weekly);
    touched.add(before_bi_weekly);
    if (split.outflow_id) touched_outflow.add(split.outflow_id); // before
    if (split.inflow_id) touched_inflow.add(split.inflow_id); // before

    // --- App-category classification (Simplified-Transaction-Categories) ---
    // Resolve the effective Plaid detailed ONCE (merchant/keyword upgrade of
    // OTHER_EXPENSE). Reused for the category label (EVERY split) and for budget
    // matching in the category path below.
    const resolved_plaid = match_category(
      {
        plaid_match_category: split.plaid_match_category,
        merchant_name: context.txn_merchant_name,
        name: context.txn_name,
      },
      context.category_rules
    ).category;

    // The split's two user-facing category slugs, derived from that resolved Plaid
    // detailed. A user override (`category_source === "user"`) is PRESERVED — the
    // engine never clobbers a manual reclassification.
    let overall_category_id: string | null;
    let first_category_id: string | null;
    let second_category_id: string | null;
    let category_source: "plaid" | "user";
    if (split.category_source === "user") {
      overall_category_id = split.overall_category_id ?? null;
      first_category_id = split.first_category_id ?? null;
      second_category_id = split.second_category_id ?? null;
      category_source = "user";
    } else {
      const slugs = context.category_slugs_by_plaid[resolved_plaid];
      overall_category_id = slugs?.overall_category_id ?? null;
      first_category_id = slugs?.first_category_id ?? null;
      // Plaid splits derive their secondary from the resolved detailed at read time
      // (doc id == detailed), so we don't persist it here — avoids write churn.
      second_category_id = null;
      category_source = "plaid";
    }

    // Effective detailed for BUDGET matching: a user override to a specific
    // second_category matches budgets keyed by that detailed; a first-only override
    // has no effective detailed (matches only by first/overall slug); a plaid split
    // uses its resolved detailed as before.
    const effective_detailed =
      category_source === "user" ? second_category_id : resolved_plaid;

    let monthly_id: string;
    let weekly_id: string;
    let bi_weekly_id: string;
    let source: "category" | "manual";
    let outflow_id: string | null;
    let inflow_id: string | null;
    let budget_reason: AssignedSplit["reason"]["budget"];
    let tie = false;
    let recurring_reason: AssignedSplit["reason"]["recurring"];

    // A manual pin is GLOBAL — it forces ALL THREE lenses onto the pinned budget.
    // Honored only while that budget still EXISTS (a real budget of any cadence, or
    // any lens's Everything Else). A stale pin (budget deleted) falls through to
    // per-lens category matching so the split re-homes.
    const pin_budget_valid =
      context.real_budgets.some((b) => b.id === split.budget_id) ||
      PERIOD_LENSES.some(
        (lens) => context.everything_else_budget_ids[lens] === split.budget_id
      );

    if (split.budget_assignment_source === "manual" && pin_budget_valid) {
      source = "manual";
      monthly_id = weekly_id = bi_weekly_id = split.budget_id;
      outflow_id = null;
      inflow_id = null;
      budget_reason = "manual";
      recurring_reason = "manual_detached";
    } else {
      source = "category";

      // 1. Effective category already resolved above (`resolved_plaid`).
      // 2. Recurring (injected from the recurring matchers).
      const recurring = context.recurring_by_split[split.split_id] ?? {
        outflow_id: null,
        inflow_id: null,
      };
      outflow_id = recurring.outflow_id;
      inflow_id = recurring.inflow_id;
      recurring_reason = outflow_id ? "outflow" : inflow_id ? "inflow" : "none";

      // 3. Budget PER LENS: each cadence is matched INDEPENDENTLY against the real
      //    budgets of THAT cadence, else that lens's Everything Else fallback.
      //    EXCEPT income (B1): unassigned in every lens; recurring inflow above
      //    still applies so income tracking works.
      if (context.txn_is_income) {
        monthly_id = weekly_id = bi_weekly_id = UNASSIGNED_BUDGET_ID;
        budget_reason = "income_excluded";
      } else {
        const split_cat = {
          internal_match_category: split.internal_match_category,
          plaid_match_category: effective_detailed,
          // Slug-level budget matching (Phase 4b): a budget may claim this split by
          // its overall/first slug, not just the Plaid detailed.
          overall_category_id,
          first_category_id,
        };
        const per_lens = {} as Record<PeriodLens, ReturnType<typeof match_budget>>;
        for (const lens of PERIOD_LENSES) {
          per_lens[lens] = match_budget(
            split_cat,
            context.txn_date_ms,
            context.real_budgets.filter((b) => b.cadence === lens),
            context.everything_else_budget_ids[lens]
          );
        }
        monthly_id = per_lens.monthly.budget_id;
        weekly_id = per_lens.weekly.budget_id;
        bi_weekly_id = per_lens.bi_monthly.budget_id;
        // reason/tie reflect the monthly lens for logging; tie = ANY lens tie.
        budget_reason = per_lens.monthly.reason;
        tie = PERIOD_LENSES.some((lens) => per_lens[lens].tie);
      }
    }

    // Missing-EE error: any lens unassigned for a NON-income split (income being
    // unassigned in every lens is intentional B1, not the missing-EE error).
    if (
      !context.txn_is_income &&
      (monthly_id === UNASSIGNED_BUDGET_ID ||
        weekly_id === UNASSIGNED_BUDGET_ID ||
        bi_weekly_id === UNASSIGNED_BUDGET_ID)
    ) {
      any_unassigned = true;
    }
    touched.add(monthly_id); // after
    touched.add(weekly_id);
    touched.add(bi_weekly_id);
    if (outflow_id) touched_outflow.add(outflow_id); // after
    if (inflow_id) touched_inflow.add(inflow_id); // after

    const next: AssignedSplit = {
      split_id: split.split_id,
      monthly_budget_id: monthly_id,
      weekly_budget_id: weekly_id,
      bi_weekly_budget_id: bi_weekly_id,
      budget_assignment_source: source,
      budget_id: monthly_id, // legacy alias
      outflow_id,
      inflow_id,
      monthly_period_id: periods.monthly_period_id,
      weekly_period_id: periods.weekly_period_id,
      bi_weekly_period_id: periods.bi_weekly_period_id,
      overall_category_id,
      first_category_id,
      second_category_id,
      category_source,
      reason: { budget: budget_reason, tie, recurring: recurring_reason },
    };
    assigned.push(next);

    if (split_assignment_changed(split, next)) {
      changed = true;
    }
  }

  return {
    splits: assigned,
    touched_budget_ids: [...touched],
    touched_outflow_ids: [...touched_outflow],
    touched_inflow_ids: [...touched_inflow],
    changed,
    any_unassigned,
  };
}

/** Whether any engine-owned field differs between the stored split and the new one. PURE. */
function split_assignment_changed(
  before: SplitForAssignment,
  after: AssignedSplit
): boolean {
  // Prior per-lens ids fall back to the legacy monthly `budget_id` for
  // pre-migration docs — so a first pass that stamps the three lens fields
  // correctly registers as a change.
  return (
    (before.monthly_budget_id ?? before.budget_id) !== after.monthly_budget_id ||
    (before.weekly_budget_id ?? before.budget_id) !== after.weekly_budget_id ||
    (before.bi_weekly_budget_id ?? before.budget_id) !== after.bi_weekly_budget_id ||
    before.budget_assignment_source !== after.budget_assignment_source ||
    before.outflow_id !== after.outflow_id ||
    before.inflow_id !== after.inflow_id ||
    before.monthly_period_id !== after.monthly_period_id ||
    before.weekly_period_id !== after.weekly_period_id ||
    before.bi_weekly_period_id !== after.bi_weekly_period_id ||
    // App-category classification (populates on first pass; preserves user overrides).
    (before.overall_category_id ?? null) !== after.overall_category_id ||
    (before.first_category_id ?? null) !== after.first_category_id ||
    (before.second_category_id ?? null) !== after.second_category_id ||
    (before.category_source ?? "plaid") !== after.category_source
  );
}
