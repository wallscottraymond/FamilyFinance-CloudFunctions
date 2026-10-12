/**
 * Match Budget Domain Service
 *
 * Pure logic for assigning ONE transaction split to a budget by category + date.
 * Real budgets are matched by `category ∈ category_ids AND date ∈ [start, end]`;
 * if none owns the category for that date, the split falls to **Everything Else
 * as a STRUCTURAL FALLBACK** (EE is the `else`, never matched by its own
 * `category_ids`). This makes an unmatched split impossible as long as the user
 * has an Everything Else budget.
 *
 * Sequenced by the Transaction Assignment Engine AFTER the manual-pin check, so
 * this service never sees manually-pinned splits.
 *
 * NO async, NO IO, NO side effects. Time is injected as epoch ms.
 *
 * @module domain/transactions/match_budget
 */

/**
 * The minimal split shape this matcher needs: its FIRST category, from `resolve_split_category`
 * (domain/transactions/split_category), the ONE category function (canon M7). Budgets own
 * `firstCategoryId` slugs and matching compares slugs only (canon A2).
 */
export interface SplitForBudgetMatch {
  first_category_id: string | null;
}

/** The three period lenses a budget (and its assignment) can belong to. */
export type PeriodLens = "monthly" | "weekly" | "bi_monthly";

/** A real (non-Everything-Else) budget, reduced to what matching needs. */
export interface BudgetForMatch {
  id: string;
  category_ids: string[];
  /** Budget start, epoch ms. */
  start_ms: number;
  /** Budget end, epoch ms — ignored when `is_ongoing`. */
  end_ms: number | null;
  is_ongoing: boolean;
  /** The budget's prime cadence — used to filter budgets per assignment lens. */
  cadence: PeriodLens;
}

/** Result of matching a split to a budget. */
export interface BudgetMatchResult {
  /** The owning budget id, or `"unassigned"` if there is no Everything Else budget. */
  budget_id: string;
  /** How the match was made. */
  reason: "category+date" | "everything_else_fallback" | "no_everything_else";
  /** The category that matched (null for the EE fallback). */
  matched_category: string | null;
  /** True when MORE THAN ONE real budget matched — a data-integrity (claims drift) signal. */
  tie: boolean;
}

/** Sentinel used when a split cannot be placed (no Everything Else budget exists). */
export const UNASSIGNED_BUDGET_ID = "unassigned";

/**
 * Whether a transaction date falls within a budget's active range.
 * PURE.
 */
export function is_within_budget_range(
  txn_date_ms: number,
  budget: BudgetForMatch
): boolean {
  if (txn_date_ms < budget.start_ms) {
    return false;
  }
  if (budget.is_ongoing) {
    return true;
  }
  return budget.end_ms !== null && txn_date_ms <= budget.end_ms;
}

/**
 * Match a split to a budget by category + date, with Everything Else as the
 * structural fallback.
 *
 * @param split - The split's category fields
 * @param txn_date_ms - The transaction date in epoch ms
 * @param real_budgets - The user's REAL budgets (Everything Else EXCLUDED)
 * @param everything_else_budget_id - The EE budget id, or null if the user has none
 * @returns The owning budget id + the reason
 *
 * PURE FUNCTION.
 */
export function match_budget(
  split: SplitForBudgetMatch,
  txn_date_ms: number,
  real_budgets: BudgetForMatch[],
  everything_else_budget_id: string | null
): BudgetMatchResult {
  // Slugs only (canon A2): a budget owns the split when it lists the split's first category.
  // `match_count` still flags multi-budget claims (drift) without changing the result.
  const first = split.first_category_id ?? null;
  let best: { budget: BudgetForMatch; matched: string } | null = null;
  let match_count = 0;
  for (const budget of real_budgets) {
    if (!first || !is_within_budget_range(txn_date_ms, budget)) {
      continue;
    }
    if (budget.category_ids.includes(first)) {
      match_count++;
      if (best === null) best = { budget, matched: first };
    }
  }

  if (best) {
    return {
      budget_id: best.budget.id,
      reason: "category+date",
      matched_category: best.matched,
      tie: match_count > 1,
    };
  }

  // Structural fallback → Everything Else (NOT matched by its category_ids).
  if (everything_else_budget_id) {
    return {
      budget_id: everything_else_budget_id,
      reason: "everything_else_fallback",
      matched_category: null,
      tie: false,
    };
  }

  // No Everything Else budget — only way to be unmatched. Orchestrator logs ERROR.
  return {
    budget_id: UNASSIGNED_BUDGET_ID,
    reason: "no_everything_else",
    matched_category: null,
    tie: false,
  };
}
