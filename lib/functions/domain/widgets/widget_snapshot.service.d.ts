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
export declare const WIDGET_DATA_VERSION = 2;
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
    occurrences?: Array<{
        due_ms: number;
        paid: boolean;
        amount: number;
    }>;
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
export interface WidgetBillItem {
    id: string;
    /** Source period the occurrence was placed in (→ the app's `{id}_{periodId}` bill detail). */
    periodId: string;
    name: string;
    dueMs: number;
    amount: number;
    overdue: boolean;
}
export type WidgetData = {
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
} | {
    v: number;
    kind: "budget_txns";
    asOfMs: number;
    budgetId: string;
    transactions: WidgetBudgetTxn[];
} | {
    v: number;
    kind: "summary";
    asOfMs: number;
    cadence: string;
    periodLabel: string;
    summary: WidgetSummary;
} | {
    v: number;
    kind: "bills";
    asOfMs: number;
    lookaheadDays: number;
    items: WidgetBillItem[];
    moreCount: number;
};
/** "Oct", "Week of Sep 28", "Oct 1–15" (UTC) — mobile `shortPeriodLabel`. */
export declare function short_period_label(cadence: string, start_ms: number, end_ms: number): string;
/** Mobile `occurrencesOf`: placed occurrences, else one aggregate row from the group. */
export declare function occurrences_of(g: WidgetOccurrenceGroupInput): Array<{
    due_ms: number;
    paid: boolean;
    amount: number;
}>;
/** Home Budgets card totals (`computeBudgetSectionTotals`). PURE. */
export declare function compute_left_to_spend(budgets: WidgetBudgetInput[], period_id: string, include_everything_else?: boolean): WidgetLeftToSpend;
/** One row per budget (period page order, Everything-Else last). PURE. */
export declare function compute_budget_lines(budgets: WidgetBudgetInput[], period_id: string): WidgetBudgetLine[];
/** Most recent transactions that count toward a budget (newest first). PURE. */
export declare function compute_recent_budget_transactions(rows: WidgetBudgetTxnInput[], limit?: number): WidgetBudgetTxn[];
/** Home Summary card (`mapResult` → `computePeriodSummary`; four planned/actual pairs). PURE. */
export declare function compute_period_summary(derived: WidgetDeriveInput, period_id: string, goals: WidgetGoalInput[]): WidgetSummary;
/**
 * Unpaid bill occurrences due by `now + lookahead_days` (overdue ones included, flagged), from
 * one or more periods' derives (current + next month). Soonest first, capped. PURE.
 */
export declare function compute_bills_due_soon(periods: Array<{
    period_id: string;
    bills: WidgetRecurringInput[];
}>, now_ms: number, lookahead_days: number): {
    items: WidgetBillItem[];
    moreCount: number;
};
//# sourceMappingURL=widget_snapshot.service.d.ts.map