/**
 * Widget Snapshot Domain Service ([[iOS-Home-Screen-Widgets]])
 *
 * Builds the data each iOS widget shows, from derive results. PURE. The backend is the single
 * source of widget numbers (the app only asks WidgetKit to reload), so every formula here
 * MIRRORS the mobile code that renders the same numbers in the app — keep them in sync:
 *
 *  - Left to spend  = mobile `mapResult` budgets → `computeBudgetSectionTotals`
 *                     (Home Budgets card; includes Everything-Else + rollover).
 *  - Period summary = mobile `mapResult` (bills/income = due-group occurrences, `occurrencesOf`)
 *                     → `computePeriodSummary` (Home Summary card; real budgets only, allocated;
 *                     active goals only).
 *  - Bills due soon = unpaid bill occurrences (same `occurrencesOf` rule) due by now+lookahead.
 *  - Labels         = mobile `shortPeriodLabel`.
 *
 * @module domain/widgets/widget_snapshot
 */

/* eslint-disable @typescript-eslint/naming-convention */
// Widget payloads are a camelCase WIRE FORMAT shared with the Swift widget (mapper-style
// exception to the snake_case rule).

export const WIDGET_DATA_VERSION = 2;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BILL_ITEMS = 6;

// ---- Inputs (structural slices of derive_period / derive_goals_view results) ----------------

export interface WidgetBudgetInput {
  is_everything_else: boolean;
  periods: Array<{
    period_id: string;
    allocated_amount: number;
    effective_amount?: number | null;
    spent: number;
  }>;
}

export interface WidgetOccurrenceGroupInput {
  period_id: string;
  is_due_period: boolean;
  count_in_period: number;
  count_paid: number;
  total_due: number;
  first_due_ms: number | null;
  next_unpaid_due_ms: number | null;
  occurrences?: Array<{ due_ms: number; paid: boolean; amount: number }>;
}

export interface WidgetRecurringInput {
  recurring_id: string;
  name: string;
  groups: WidgetOccurrenceGroupInput[];
}

export interface WidgetDeriveInput {
  budgets: WidgetBudgetInput[];
  bills: WidgetRecurringInput[];
  income: WidgetRecurringInput[];
}

export interface WidgetGoalInput {
  status: string;
  targetForPeriod: number;
  progressForPeriod: number;
}

// ---- Outputs ------------------------------------------------------------------------------

export interface WidgetLeftToSpend {
  available: number;
  budgeted: number;
  spent: number;
  over: boolean;
  hasBudgets: boolean;
}

export interface PlannedActual {
  planned: number;
  actual: number;
}

export interface WidgetSummary {
  income: PlannedActual;
  bills: PlannedActual;
  budgets: PlannedActual;
  goals: PlannedActual;
  isEmpty: boolean;
}

export interface WidgetBillItem {
  id: string;
  /** Source period the occurrence was placed in (→ the app's `{id}_{periodId}` bill detail). */
  periodId: string;
  name: string;
  dueMs: number;
  amount: number;
  overdue: boolean;
}

export type WidgetData =
  | {
      v: number;
      kind: "left";
      asOfMs: number;
      cadence: string;
      periodLabel: string;
      leftToSpend: WidgetLeftToSpend;
      leftToSpendRealOnly: WidgetLeftToSpend;
    }
  | {
      v: number;
      kind: "summary";
      asOfMs: number;
      cadence: string;
      periodLabel: string;
      summary: WidgetSummary;
    }
  | {
      v: number;
      kind: "bills";
      asOfMs: number;
      lookaheadDays: number;
      items: WidgetBillItem[];
      moreCount: number;
    };

// ---- Shared helpers (mirror mobile) ----------------------------------------------------------

/** "Oct", "Week of Sep 28", "Oct 1–15" (UTC) — mobile `shortPeriodLabel`. */
export function short_period_label(cadence: string, start_ms: number, end_ms: number): string {
  const s = new Date(start_ms);
  const e = new Date(end_ms);
  const mon = MONTHS[s.getUTCMonth()];
  if (cadence === "weekly") return `Week of ${mon} ${s.getUTCDate()}`;
  if (cadence === "bi_monthly") return `${mon} ${s.getUTCDate()}–${e.getUTCDate()}`;
  return mon ?? "";
}

/** Mobile `occurrencesOf`: placed occurrences, else one aggregate row from the group. */
export function occurrences_of(
  g: WidgetOccurrenceGroupInput
): Array<{ due_ms: number; paid: boolean; amount: number }> {
  if (g.occurrences && g.occurrences.length > 0) return g.occurrences;
  const count = g.count_in_period ?? 0;
  if (count <= 0) return [];
  return [
    {
      due_ms: g.first_due_ms ?? g.next_unpaid_due_ms ?? 0,
      paid: (g.count_paid ?? 0) >= count,
      amount: g.total_due ?? 0,
    },
  ];
}

/** Mobile `mapResult`'s due-group lookup for a period. */
function due_group(
  r: WidgetRecurringInput,
  period_id: string
): WidgetOccurrenceGroupInput | undefined {
  return r.groups.find((g) => g.period_id === period_id && g.is_due_period);
}

/** The budget's derive period for the viewed period (mobile `mapResult`: match, else first). */
function budget_period(b: WidgetBudgetInput, period_id: string) {
  return b.periods.find((p) => p.period_id === period_id) ?? b.periods[0];
}

// ---- Left to spend ---------------------------------------------------------------------------

/** Home Budgets card totals (`computeBudgetSectionTotals`). PURE. */
export function compute_left_to_spend(
  budgets: WidgetBudgetInput[],
  period_id: string,
  include_everything_else = true
): WidgetLeftToSpend {
  let budgeted = 0;
  let spent = 0;
  for (const b of budgets) {
    if (!include_everything_else && b.is_everything_else) continue;
    const p = budget_period(b, period_id);
    const allocated = p?.allocated_amount ?? 0;
    budgeted += p?.effective_amount ?? allocated;
    spent += p?.spent ?? 0;
  }
  const available = budgeted - spent;
  return {
    available,
    budgeted,
    spent,
    over: available < 0,
    hasBudgets: budgets.some((b) => !b.is_everything_else),
  };
}

// ---- Period summary --------------------------------------------------------------------------

/** Home Summary card (`mapResult` → `computePeriodSummary`; four planned/actual pairs). PURE. */
export function compute_period_summary(
  derived: WidgetDeriveInput,
  period_id: string,
  goals: WidgetGoalInput[]
): WidgetSummary {
  const recurring = (items: WidgetRecurringInput[]) => {
    let planned = 0;
    let actual = 0;
    let entries = 0;
    for (const r of items) {
      const g = due_group(r, period_id);
      if (!g) continue;
      for (const o of occurrences_of(g)) {
        entries += 1;
        planned += o.amount;
        actual += o.paid ? o.amount : 0;
      }
    }
    return { planned, actual, entries };
  };
  const income = recurring(derived.income);
  const bills = recurring(derived.bills);

  let budgets_planned = 0;
  let budgets_spent = 0;
  let real_budgets = 0;
  for (const b of derived.budgets) {
    if (b.is_everything_else) continue;
    real_budgets += 1;
    const p = budget_period(b, period_id);
    budgets_planned += p?.allocated_amount ?? 0; // Summary uses totalAllocated (not effective)
    budgets_spent += p?.spent ?? 0;
  }

  const active_goals = goals.filter((g) => g.status === "active");
  const goals_planned = active_goals.reduce((s, g) => s + (g.targetForPeriod || 0), 0);
  const goals_actual = active_goals.reduce((s, g) => s + (g.progressForPeriod || 0), 0);

  return {
    income: { planned: income.planned, actual: income.actual },
    bills: { planned: bills.planned, actual: bills.actual },
    budgets: { planned: budgets_planned, actual: budgets_spent },
    goals: { planned: goals_planned, actual: goals_actual },
    isEmpty:
      income.entries === 0 &&
      bills.entries === 0 &&
      real_budgets === 0 &&
      active_goals.length === 0,
  };
}

// ---- Bills due soon --------------------------------------------------------------------------

/**
 * Unpaid bill occurrences due by `now + lookahead_days` (overdue ones included, flagged), from
 * one or more periods' derives (current + next month). Soonest first, capped. PURE.
 */
export function compute_bills_due_soon(
  periods: Array<{ period_id: string; bills: WidgetRecurringInput[] }>,
  now_ms: number,
  lookahead_days: number
): { items: WidgetBillItem[]; moreCount: number } {
  const today_start = Math.floor(now_ms / DAY_MS) * DAY_MS; // occurrence dates are UTC days
  const horizon = today_start + (lookahead_days + 1) * DAY_MS - 1;
  const seen = new Set<string>();
  const items: WidgetBillItem[] = [];
  for (const { period_id, bills } of periods) {
    for (const r of bills) {
      const g = due_group(r, period_id);
      if (!g) continue;
      for (const o of occurrences_of(g)) {
        if (o.paid || o.due_ms > horizon) continue;
        const key = `${r.recurring_id}:${o.due_ms}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          id: r.recurring_id,
          periodId: period_id,
          name: r.name,
          dueMs: o.due_ms,
          amount: o.amount,
          overdue: o.due_ms < today_start,
        });
      }
    }
  }
  items.sort((a, b) => a.dueMs - b.dueMs || b.amount - a.amount);
  return {
    items: items.slice(0, MAX_BILL_ITEMS),
    moreCount: Math.max(0, items.length - MAX_BILL_ITEMS),
  };
}
