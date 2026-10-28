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
 *  - Budget lines   = one row per budget like the period page's budget rows (effective limit,
 *                     spent, remaining), Everything-Else last.
 *  - Budget txns    = the budget's derive_budget_transactions rows (Budget Detail list), newest
 *                     first, counted/refund only (ignored rows don't count toward the budget).
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
  budget_id?: string;
  name?: string;
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

export interface WidgetBudgetLine {
  id: string;
  name: string;
  isEverythingElse: boolean;
  /** Effective limit (allocation + rollover; Everything-Else = derived leftover). */
  budgeted: number;
  spent: number;
  available: number;
  over: boolean;
}

/** Slice of a derive_budget_transactions row. */
export interface WidgetBudgetTxnInput {
  transaction_id: string;
  date_ms: number;
  name: string;
  amount: number;
  is_pending: boolean;
  spend_status: string;
}

export interface WidgetBudgetTxn {
  id: string;
  name: string;
  dateMs: number;
  amount: number;
  pending: boolean;
  refund: boolean;
}

/** A raw transaction doc, as read for the Recent transactions widget. */
export interface WidgetRawTxn {
  id: string;
  data: Record<string, unknown>;
}

/** One row of the Recent transactions widget (camelCase wire format, like the other kinds). */
export interface WidgetRecentTxn {
  id: string;
  /** With `id` → the app's transaction detail link. */
  accountId: string;
  name: string;
  dateMs: number;
  /** Magnitude; `income` says which way it went (the app shows "+" for money in). */
  amount: number;
  income: boolean;
  pending: boolean;
  /** Set when a split pays a recurring bill: that bill's name. */
  bill: string | null;
  /** The primary split's budget ("Everything else", or "Income" for money in with no budget). */
  budget: string | null;
  /** How many OTHER budgets the splits go to ("Groceries +1"). */
  moreBudgets: number;
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

/** Every payload; `groupName` is set only for a widget showing a group view (its small label). */
export type WidgetData = WidgetPayload & { groupName?: string };

type WidgetPayload =
  | {
      v: number;
      kind: "left";
      asOfMs: number;
      cadence: string;
      periodLabel: string;
      /** Period bounds → the widget draws the app's weekly segments + "today" marker. */
      startMs: number;
      endMs: number;
      leftToSpend: WidgetLeftToSpend;
      leftToSpendRealOnly: WidgetLeftToSpend;
      budgets: WidgetBudgetLine[];
    }
  | {
      v: number;
      kind: "budget_txns";
      asOfMs: number;
      budgetId: string;
      transactions: WidgetBudgetTxn[];
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
    }
  | {
      v: number;
      kind: "recent";
      asOfMs: number;
      recent: WidgetRecentTxn[];
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

// ---- Budget lines + transactions -----------------------------------------------------------

/** One row per budget (period page order, Everything-Else last). PURE. */
export function compute_budget_lines(
  budgets: WidgetBudgetInput[],
  period_id: string
): WidgetBudgetLine[] {
  const lines = budgets.map((b, i) => {
    const p = budget_period(b, period_id);
    const allocated = p?.allocated_amount ?? 0;
    const budgeted = p?.effective_amount ?? allocated;
    const spent = p?.spent ?? 0;
    const available = budgeted - spent;
    return {
      order: i,
      line: {
        id: b.budget_id ?? `budget-${i}`,
        name: b.name ?? "Budget",
        isEverythingElse: b.is_everything_else,
        budgeted,
        spent,
        available,
        over: available < 0,
      },
    };
  });
  lines.sort(
    (a, b) =>
      Number(a.line.isEverythingElse) - Number(b.line.isEverythingElse) || a.order - b.order
  );
  return lines.map((l) => l.line);
}

/** Most recent transactions that count toward a budget (newest first). PURE. */
// ---- Recent transactions (mirrors the app's Home card with "Hide transfers" on) --------------

/** Most rows any size shows (large). */
export const MAX_RECENT_TXNS = 9;

type RawSplit = Record<string, unknown>;

function splits_of(data: Record<string, unknown>): RawSplit[] {
  return Array.isArray(data.splits) ? (data.splits as RawSplit[]) : [];
}

function millis_of(v: unknown): number {
  const t = v as { toMillis?: () => number } | undefined;
  return typeof t?.toMillis === "function" ? t.toMillis() : 0;
}

/** The app's `transactionDate || dateTransacted || date`. */
function txn_date_ms(data: Record<string, unknown>): number {
  return millis_of(data.transactionDate) || millis_of(data.dateTransacted) || millis_of(data.date);
}

/** The app's `isTransferTransaction`: the stored matched-pair role decides ("internal" between your
 *  own accounts, "external" unpaired); without one, every split must be a transfer category. */
export function is_recent_transfer(data: Record<string, unknown>): boolean {
  const role = data.transferRole;
  if (typeof role === "string" && role.length > 0) {
    return role === "internal" || role === "external";
  }
  const splits = splits_of(data);
  if (splits.length === 0) return false;
  return splits.every((s) =>
    /^TRANSFER_(IN|OUT)/.test(String(s.plaidDetailedCategory ?? s.plaidPrimaryCategory ?? ""))
  );
}

/**
 * The rows the widget shows, newest first: what the app's Home card lists (not soft-deleted, has an
 * owner and at least one split) minus transfers, de-duplicated by id. PURE.
 */
export function select_recent_transactions(
  rows: WidgetRawTxn[],
  limit = MAX_RECENT_TXNS
): WidgetRawTxn[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      const d = r.data;
      if (d.isActive === false || d.isDeleted === true) return false;
      if (!d.userId || splits_of(d).length === 0) return false;
      return !is_recent_transfer(d);
    })
    .sort((a, b) => txn_date_ms(b.data) - txn_date_ms(a.data))
    .slice(0, limit);
}

/** The bill ids the selected rows paid (a split not ignored, linked to an outflow). PURE. */
export function recent_bill_ids(rows: WidgetRawTxn[]): string[] {
  const ids = new Set<string>();
  for (const r of rows) {
    for (const s of splits_of(r.data)) {
      const outflow_id = s.outflowId;
      if (s.isIgnored !== true && typeof outflow_id === "string" && outflow_id) ids.add(outflow_id);
    }
  }
  return [...ids];
}

/** A bill's display name, as the app's bill rows name it. PURE. */
function bill_name(doc: Record<string, unknown> | undefined, fallback: unknown): string {
  const pick = [doc?.userCustomName, doc?.merchantName, doc?.description, fallback].find(
    (v) => typeof v === "string" && v.trim().length > 0
  );
  return (pick as string | undefined) ?? "Bill";
}

/** The selected rows as the widget wire format. `bills` = outflow docs by id. PURE. */
export function compute_recent_transactions(
  rows: WidgetRawTxn[],
  bills: Map<string, Record<string, unknown>>
): WidgetRecentTxn[] {
  return rows.map(({ id, data }) => {
    const splits = splits_of(data);
    const split_total = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
    const total = splits.length > 0 ? split_total : Number(data.amount) || 0;
    const income = typeof data.type === "string" && data.type ? data.type === "income" : total < 0;
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const name =
      [data.merchantName, metadata.plaidMerchantName, data.name, data.description].find(
        (v) => typeof v === "string" && v.trim().length > 0
      ) as string | undefined;
    const bill_split = splits.find(
      (s) => s.isIgnored !== true && typeof s.outflowId === "string" && s.outflowId
    );
    const primary = splits.find((s) => s.isDefault === true) ?? splits[0];
    const budget_names = [
      ...new Set(
        splits
          .map((s) => s.budgetName)
          .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
      ),
    ];
    const primary_name = primary?.budgetName;
    const primary_budget =
      typeof primary_name === "string" && primary_name.trim() ? primary_name : null;
    return {
      id,
      accountId: typeof data.accountId === "string" ? data.accountId : "",
      name: name ?? "Transaction",
      dateMs: txn_date_ms(data),
      amount: Math.abs(total),
      income,
      pending:
        data.isPending === true || data.pending === true || data.transactionStatus === "pending",
      bill: bill_split
        ? bill_name(bills.get(bill_split.outflowId as string), bill_split.outflowDescription)
        : null,
      budget: primary_budget ?? budget_names[0] ?? (income ? "Income" : null),
      moreBudgets: Math.max(0, budget_names.length - 1),
    };
  });
}

export function compute_recent_budget_transactions(
  rows: WidgetBudgetTxnInput[],
  limit = 5
): WidgetBudgetTxn[] {
  return rows
    .filter((r) => r.spend_status !== "ignored")
    .sort((a, b) => b.date_ms - a.date_ms)
    .slice(0, limit)
    .map((r) => ({
      id: r.transaction_id,
      name: r.name,
      dateMs: r.date_ms,
      amount: r.amount,
      pending: r.is_pending,
      refund: r.spend_status === "refund",
    }));
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
