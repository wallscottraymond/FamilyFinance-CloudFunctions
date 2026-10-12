/**
 * Budget Spend Match (read-time) Domain Service
 *
 * Derive-On-Read Period Architecture — the "instant budgets" unlock.
 *
 * Resolves which budget a split belongs to ON READ, from the split's category +
 * manual pin, instead of reading a pre-computed stored `budgetId`. This is what
 * lets a brand-new budget show its transactions immediately (no write-time
 * assignment cascade) while still honoring user intent.
 *
 * Precedence (the engine's existing order, run on read):
 *   1. manual pin (budget_assignment_source === "manual")  → that budget
 *   2. category match (reuses `match_budget`: detailed → first → overall slug)
 *   3. Everything-Else structural fallback (also from `match_budget`)
 * Rules (future) slot between 1 and 2 without changing this shape.
 *
 * Recurring-linked splits (outflow_id/inflow_id set) are still excluded from
 * budget spend by `is_countable` downstream, so this matcher can ignore them.
 *
 * PURE: no IO, no side effects. Reuses `match_budget` + `compute_budget_spent`
 * unchanged, so it stays consistent with the write-time engine's decisions.
 *
 * @module domain/budgets/budget_spend_match
 */

import {
  match_budget,
  BudgetForMatch,
} from "../transactions/match_budget.service";
import {
  SplitForSpend,
  SpendStatusForSpend,
  is_income_category,
  is_transfer_category,
} from "./budget_spend.service";

/** A split with everything the read-time owner resolution + spend need. */
export interface SplitForOnReadMatch {
  // Spend inputs
  amount: number;
  txn_date_ms: number;
  is_pending: boolean;
  is_transfer: boolean;
  /** Transaction-level credit (`type: "income"`) — drives return-vs-spend direction. */
  is_income: boolean;
  spend_status: SpendStatusForSpend;
  outflow_id: string | null;
  inflow_id: string | null;
  /** Txn is in a recurring bill/income Plaid stream (even if this split's link is
   *  unset) → excluded from budget spend (S5). Optional; defaults false. */
  is_recurring_member?: boolean;
  // Category inputs — from the ONE category function (domain/transactions/split_category)
  first_category_id: string | null;
  /** The Plaid code giving the category its meaning (income? transfer?). */
  semantic_code: string;
  /** Manual budget pin (user assigned this split to a budget); null otherwise. */
  manual_pin_budget_id: string | null;
  /** Account-Rooted-Sharing D12: this split is money leaving the VIEW through a transfer to a
   *  member's account in another view → it counts as spending here even though it's a
   *  transfer. Optional; defaults false (always false with nothing shared). */
  is_edge_out?: boolean;
}

/**
 * Resolve the budget a split belongs to on read.
 *
 * @param split        - The split's category + pin
 * @param real_budgets - The user's REAL budgets (Everything Else EXCLUDED)
 * @param ee_budget_id - The Everything-Else budget id, or null if none
 *
 * PURE.
 */
export function resolve_split_owner(
  split: SplitForOnReadMatch,
  real_budgets: BudgetForMatch[],
  ee_budget_id: string | null,
  ee_alias_ids: ReadonlySet<string> = NO_ALIASES
): string {
  // 1. Manual pin wins — but ONLY while its budget still exists (a real budget or the EE).
  //    A pin to a DELETED budget is stale, so we fall through to category matching (→ EE),
  //    which re-homes the deleted budget's spending to Everything Else instead of orphaning it.
  const pinned = pin_owner(split, real_budgets, ee_budget_id, ee_alias_ids);
  if (pinned) return pinned;
  // 2/3. Category match → else Everything-Else (both from the shared matcher).
  return match_budget(split, split.txn_date_ms, real_budgets, ee_budget_id).budget_id;
}

const NO_ALIASES: ReadonlySet<string> = new Set();

/**
 * The budget a live manual pin puts the split in, else null. A pin to ANY lens's Everything Else
 * means "Everything Else" (the user picked it in whichever view they were in) — it lands in
 * `ee_budget_id`, exactly as the engine stores it (each lens's own Everything Else).
 */
function pin_owner(
  split: SplitForOnReadMatch,
  real_budgets: BudgetForMatch[],
  ee_budget_id: string | null,
  ee_alias_ids: ReadonlySet<string>
): string | null {
  const pin = split.manual_pin_budget_id;
  if (!pin) return null;
  if (pin === ee_budget_id) return pin;
  if (ee_alias_ids.has(pin)) return ee_budget_id ?? pin;
  return real_budgets.some((b) => b.id === pin) ? pin : null;
}

/**
 * The splits owned by `target_budget_id` on read, mapped to `SplitForSpend`
 * (with `budget_id` stamped to the target) so they flow straight into the
 * existing spend/derivation path.
 *
 * PURE.
 */
export function owned_splits_for_budget(
  target_budget_id: string,
  real_budgets: BudgetForMatch[],
  ee_budget_id: string | null,
  splits: SplitForOnReadMatch[],
  ee_alias_ids: ReadonlySet<string> = NO_ALIASES
): SplitForSpend[] {
  const out: SplitForSpend[] = [];
  for (const s of splits) {
    if (resolve_split_owner(s, real_budgets, ee_budget_id, ee_alias_ids) !== target_budget_id) {
      continue;
    }
    // A manual budget pin is the user's explicit word (canon A4, engine B2): the split counts in
    // the pinned budget even when it's a transfer or an income-category credit — exactly as the
    // assignment engine stores it.
    const pinned = pin_owner(s, real_budgets, ee_budget_id, ee_alias_ids) === target_budget_id;
    out.push({
      budget_id: target_budget_id,
      amount: s.amount,
      txn_date_ms: s.txn_date_ms,
      is_pending: s.is_pending,
      is_transfer: pinned ? false : s.is_transfer,
      is_income: s.is_income,
      is_income_category: !pinned && is_income_category(s.semantic_code),
      is_transfer_category:
        !pinned && !s.is_edge_out && is_transfer_category(s.semantic_code),
      spend_status: s.spend_status,
      outflow_id: s.outflow_id,
      inflow_id: s.inflow_id,
      is_recurring_member: s.is_recurring_member,
    });
  }
  return out;
}
