/**
 * Match budgets — THE budget set every split-to-budget decision uses (canon A11 "stored ==
 * derived"): the assignment engine (what's STORED), the period page, a budget's transaction list
 * and its spend (what's COUNTED) all build their budgets here, so they can't disagree on which
 * budgets exist for a date.
 *
 *   - A real budget is active from the START OF ITS OWN-CADENCE PERIOD that contains its start
 *     date (a budget created mid-month owns that month's earlier purchases — its allocation covers
 *     the whole period), through `budget_end_date` (the user's end for a limited budget; the legacy
 *     `end_date` is only the first period's end) — or forever when ongoing.
 *   - Budgets of EVERY cadence own their categories in every lens (a weekly Groceries budget owns
 *     groceries in the monthly view too — as the period page counts it).
 *   - Everything Else is the structural fallback, one per lens.
 *
 * Source periods are calendar-exact (UTC): months; halves 1–15 / 16–end; weeks starting Sunday.
 *
 * PURE.
 *
 * @module domain/budgets/match_budgets
 */

import { BudgetForMatch, PeriodLens } from "../transactions/match_budget.service";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start (ms) of the cadence period containing `ms` — same bounds as the source periods. */
export function period_start_ms(ms: number, cadence: PeriodLens): number {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (cadence === "monthly") return Date.UTC(y, m, 1);
  if (cadence === "bi_monthly") return Date.UTC(y, m, d.getUTCDate() <= 15 ? 1 : 16);
  const day_start = Date.UTC(y, m, d.getUTCDate());
  return day_start - d.getUTCDay() * DAY_MS; // weekly: back to Sunday
}

/** A budget as the builder needs it (mapped from the entity by the caller). */
export interface BudgetForMatchInput {
  id: string;
  name: string;
  cadence: PeriodLens;
  category_ids: string[];
  start_ms: number;
  /** `budget_end_date` ?? `end_date` (ms); ignored when ongoing. */
  end_ms: number | null;
  is_ongoing: boolean;
  is_everything_else: boolean;
}

export interface MatchBudgets {
  real_budgets: BudgetForMatch[];
  everything_else_ids: Record<PeriodLens, string | null>;
  /** The monthly Everything Else, else any — the period page's single fallback. */
  primary_everything_else_id: string | null;
  names: Record<string, string>;
}

export function build_match_budgets(budgets: BudgetForMatchInput[]): MatchBudgets {
  const real_budgets: BudgetForMatch[] = [];
  const everything_else_ids: Record<PeriodLens, string | null> = {
    monthly: null,
    weekly: null,
    bi_monthly: null,
  };
  const names: Record<string, string> = {};
  let any_ee: string | null = null;
  for (const b of budgets) {
    names[b.id] = b.name;
    if (b.is_everything_else) {
      any_ee = any_ee ?? b.id;
      if (!everything_else_ids[b.cadence]) everything_else_ids[b.cadence] = b.id;
      continue;
    }
    real_budgets.push({
      id: b.id,
      category_ids: b.category_ids ?? [],
      start_ms: period_start_ms(b.start_ms, b.cadence),
      end_ms: b.is_ongoing ? null : b.end_ms,
      is_ongoing: b.is_ongoing,
      cadence: b.cadence,
    });
  }
  return {
    real_budgets,
    everything_else_ids,
    primary_everything_else_id: everything_else_ids.monthly ?? any_ee,
    names,
  };
}

/** The stored budget → the builder's input (the one place `budget_end_date ?? end_date` lives). */
export function budget_to_match_input(b: {
  id: string;
  name: string;
  period: string;
  category_ids?: string[];
  start_date: { toMillis(): number };
  end_date?: { toMillis(): number } | null;
  budget_end_date?: { toMillis(): number } | null;
  is_ongoing: boolean;
  is_system_everything_else?: boolean;
}): BudgetForMatchInput {
  const cadence: PeriodLens =
    b.period === "weekly" ? "weekly" : b.period === "bi_monthly" ? "bi_monthly" : "monthly";
  const end = b.budget_end_date ?? b.end_date ?? null;
  return {
    id: b.id,
    name: b.name,
    cadence,
    category_ids: b.category_ids ?? [],
    start_ms: b.start_date.toMillis(),
    end_ms: end ? end.toMillis() : null,
    is_ongoing: b.is_ongoing,
    is_everything_else: b.is_system_everything_else === true,
  };
}
