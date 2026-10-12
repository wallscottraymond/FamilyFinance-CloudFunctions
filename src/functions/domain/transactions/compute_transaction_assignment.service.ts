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
  is_within_budget_range,
  match_budget,
  BudgetForMatch,
  PeriodLens,
  UNASSIGNED_BUDGET_ID,
} from "./match_budget.service";

/** The three period lenses, in a stable order. */
export const PERIOD_LENSES: PeriodLens[] = ["monthly", "weekly", "bi_monthly"];
import { is_income_category, is_transfer_category } from "./category_semantics.service";
import { resolve_split_category, CategoryCatalog } from "./split_category.service";
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
  /** Raw Plaid detailed code (immutable). The legacy `internalDetailedCategory` override is
   *  NOT an input any more (canon M2) — user picks live in the slug fields + `category_source`. */
  plaid_match_category: string;
  outflow_id: string | null;
  /** Manual bill-assignment pin: when `"manual"`, `outflow_id` is a user-chosen bill
   *  that the engine PRESERVES (doesn't re-derive) while that outflow still exists —
   *  survives Plaid re-sync. Defaults to `"auto"` (engine derives from recurring match). */
  outflow_source?: "auto" | "manual";
  /** A manual bill pin PARKED while its bill is removed / paused for this payment's month (the
   *  money counts as spending meanwhile); restored when the bill is live again (X9). */
  suspended_outflow_pin?: string | null;
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
  /** The transaction's stored transfer role (3d, canon A7) — "edge_out" money leaving the view
   *  is spending (as on the period page); absent = not yet classified. */
  txn_transfer_role?: string | null;
  /** All real budgets across every cadence; the engine filters per lens. */
  real_budgets: BudgetForMatch[];
  /** The Everything Else budget id PER LENS (null for a lens with no EE budget). */
  everything_else_budget_ids: Record<PeriodLens, string | null>;
  /** The `categories` collection as the ONE category function needs it (canon M7). */
  category_catalog: CategoryCatalog;
  source_periods: SourcePeriodForMatch[];
  /** Recurring match per split id (empty = no recurring match). */
  recurring_by_split: Record<string, RecurringMatch>;
  /** Active outflow (bill) ids — validates a manual outflow pin so a stale pin (bill
   *  deleted) falls back to auto-derivation. Omitted → pins are trusted as-is. */
  active_outflow_ids?: Set<string>;
  /** Bills (in this view) removed / paused for this transaction's month: a manual pin to one is
   *  PARKED (`suspended_outflow_pin`), not dropped, so Restore brings it back. */
  suppressed_outflow_ids?: Set<string>;
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
  /** "manual" = a user-pinned bill assignment the engine preserves; else "auto". */
  outflow_source: "auto" | "manual";
  /** A parked manual bill pin (see `SplitForAssignment.suspended_outflow_pin`), else null. */
  suspended_outflow_pin: string | null;
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
    budget: "category+date" | "everything_else_fallback" | "no_everything_else" | "manual" | "income_excluded" | "transfer_excluded";
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

    // --- Category: the ONE category function (canon M7) — user / rule pick → merchant &
    // keyword rules → Plaid code → collection → Other. Its `match_keys` drive budget matching
    // (a user pick never ranks the original Plaid code) and `semantic_code` gives it its
    // income / transfer meaning.
    const category = resolve_split_category(
      {
        plaid_detailed: split.plaid_match_category,
        category_source: split.category_source ?? "plaid",
        first_category_id: split.first_category_id ?? null,
        overall_category_id: split.overall_category_id ?? null,
        second_category_id: split.second_category_id ?? null,
        merchant_name: context.txn_merchant_name,
        name: context.txn_name,
      },
      context.category_catalog
    );
    // A stored user pick the function can't read (no slug at all) is never demoted to Plaid —
    // its fields are kept as stored; matching falls back to Plaid's category meanwhile.
    const keep_stored = split.category_source === "user" && category.category_source !== "user";
    const overall_category_id = keep_stored
      ? split.overall_category_id ?? null
      : category.overall_category_id;
    const first_category_id = keep_stored
      ? split.first_category_id ?? null
      : category.first_category_id;
    const second_category_id = keep_stored
      ? split.second_category_id ?? null
      : category.second_category_id;
    const category_source = keep_stored ? "user" : category.category_source;

    // A Plaid account-transfer split (TRANSFER_IN/OUT) is money moving between accounts, not
    // spending — it never auto-assigns to a budget (mirrors the income B1 rule), EXCEPT money
    // leaving the view (an "edge_out" transfer, 3d): the period page counts that as spending, so
    // it's assigned by category like any purchase. A user pick of a non-transfer category makes
    // it spending.
    const is_transfer =
      is_transfer_category(category.semantic_code) && context.txn_transfer_role !== "edge_out";
    // Income stays out of budgets (B1) — decided by the CATEGORY, as the period page decides it:
    // an income-category split never counts (either direction), while a CREDIT in a spending
    // category is a refund / return the page nets against that category's budget — so it's
    // assigned by category like the purchase it reverses (canon A8, A11).
    const is_income = is_income_category(category.semantic_code);

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
    // per-lens category matching so the split re-homes. A pin to any lens's Everything Else
    // means "Everything Else": each lens stores ITS Everything Else (as the page counts it).
    const pin_is_ee = PERIOD_LENSES.some(
      (lens) => context.everything_else_budget_ids[lens] === split.budget_id
    );
    // A pin to a real budget holds only while that budget is ACTIVE on the transaction's date
    // (a September purchase pinned to a budget that starts in October would count nowhere — its
    // period doesn't exist); else it falls back to category matching, as on the page.
    const pin_budget_valid =
      pin_is_ee ||
      context.real_budgets.some(
        (b) => b.id === split.budget_id && is_within_budget_range(context.txn_date_ms, b)
      );

    if (split.budget_assignment_source === "manual" && pin_budget_valid) {
      source = "manual";
      monthly_id = weekly_id = bi_weekly_id = split.budget_id;
      if (pin_is_ee) {
        const ee = context.everything_else_budget_ids;
        monthly_id = ee.monthly ?? split.budget_id;
        weekly_id = ee.weekly ?? split.budget_id;
        bi_weekly_id = ee.bi_monthly ?? split.budget_id;
      }
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

      // 3. Budget PER LENS: a budget of ANY cadence owns its categories in every lens (as the
      //    period page counts it — domain/budgets/match_budgets), else that lens's Everything
      //    Else. EXCEPT income (B1) and transfers: unassigned in every lens. Any recurring
      //    inflow/outflow match above still applies for tracking.
      if (is_income || is_transfer) {
        monthly_id = weekly_id = bi_weekly_id = UNASSIGNED_BUDGET_ID;
        budget_reason = is_transfer ? "transfer_excluded" : "income_excluded";
      } else {
        // Slugs only (canon A2) — the function's first (Plaid's, when a stored pick is unreadable).
        const split_cat = { first_category_id: category.first_category_id };
        const per_lens = {} as Record<PeriodLens, ReturnType<typeof match_budget>>;
        for (const lens of PERIOD_LENSES) {
          per_lens[lens] = match_budget(
            split_cat,
            context.txn_date_ms,
            context.real_budgets,
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

    // Manual bill pin: the user assigned this split to a specific bill. It OVERRIDES
    // auto-derivation (and a manual-budget detach's null), and is PRESERVED across
    // re-syncs — as long as the pinned outflow still exists (else fall back to auto).
    let outflow_source: "auto" | "manual" = "auto";
    let suspended_outflow_pin: string | null = null;
    const suppressed = context.suppressed_outflow_ids;
    const is_live = (id: string): boolean =>
      !context.active_outflow_ids || context.active_outflow_ids.has(id);
    // A pin parked while its bill was removed / paused comes back once the bill is live again for
    // this month — unless the user has since pinned the split to a BUDGET (that pin wins, A4).
    const parked = split.suspended_outflow_pin ?? null;
    let pin_id = split.outflow_id;
    let pin_source = split.outflow_source;
    if (parked && pin_source !== "manual" && source !== "manual") {
      if (is_live(parked)) {
        pin_id = parked;
        pin_source = "manual";
      } else if (suppressed?.has(parked)) {
        suspended_outflow_pin = parked; // still removed / paused here — keep it parked
      }
    }
    if (pin_source === "manual" && pin_id && suppressed?.has(pin_id)) {
      // Pinned to a bill removed / paused for this month: the payment counts as spending, and the
      // pin is parked (not lost) for when the bill is restored.
      suspended_outflow_pin = pin_id;
      outflow_id = null;
    } else if (pin_source === "manual" && pin_id && is_live(pin_id)) {
      outflow_id = pin_id;
      outflow_source = "manual";
      recurring_reason = "outflow";
    } else if (pin_source === "manual" && !pin_id) {
      // Manual DETACH ("remove from bill"): the user said this split pays NO bill. Durable —
      // beats the recurring matcher / Plaid stream membership, which would otherwise re-link it.
      outflow_id = null;
      outflow_source = "manual";
      recurring_reason = "manual_detached";
    }

    // Edge money (3d: a transfer crossing the view — edge_out / edge_in) is never a bill payment
    // or a paycheck: the period page drops every recurring link on it (stream membership, split
    // links, manual pins) and counts it as spending / money in. Store no link either. The user's
    // own bill choices survive a later sharing change: a manual bill pin is PARKED (as for a
    // removed bill), and a "remove from bill" detach stays (it already means "no bill").
    if (context.txn_transfer_role === "edge_out" || context.txn_transfer_role === "edge_in") {
      if (outflow_source === "manual" && outflow_id) suspended_outflow_pin = outflow_id;
      const keep_detach = outflow_source === "manual" && !outflow_id;
      outflow_id = null;
      inflow_id = null;
      outflow_source = keep_detach ? "manual" : "auto";
      recurring_reason = keep_detach ? "manual_detached" : "none";
    }

    // Missing-EE error: any lens unassigned for a NON-income, NON-transfer split
    // (income/transfers being unassigned in every lens is intentional, not the
    // missing-EE error).
    if (
      !is_income &&
      !is_transfer &&
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
      outflow_source,
      suspended_outflow_pin,
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
    (before.outflow_source ?? "auto") !== after.outflow_source ||
    (before.suspended_outflow_pin ?? null) !== after.suspended_outflow_pin ||
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
