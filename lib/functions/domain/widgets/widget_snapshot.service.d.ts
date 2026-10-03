/**
 * Widget Snapshot Domain Service ([[iOS-Home-Screen-Widgets]])
 *
 * Builds the widget snapshot (schema v1) from a derive_period result. PURE.
 *
 * PARITY: "left to spend" mirrors the mobile Home Budgets card exactly —
 *   mobile `mapResult` (useDerivedPeriod.ts): per budget, the derive period matching the
 *   current period id (else the first); effective = effective_amount ?? allocated_amount;
 *   mobile `computeBudgetSectionTotals` (budgetSection.ts): budgeted = Σ effective,
 *   spent = Σ spent, available = budgeted − spent, over = available < 0;
 *   hasBudgets = any non-Everything-Else budget.
 * The short period label mirrors mobile `shortPeriodLabel` (periodLabel.ts).
 * Keep these in sync with the mobile code and `ios/BudgWidgets/WidgetSnapshot.swift`.
 *
 * @module domain/widgets/widget_snapshot
 */
export declare const WIDGET_SNAPSHOT_VERSION = 1;
/** The slice of a derive_period budget this service needs. */
export interface WidgetBudgetInput {
    is_everything_else: boolean;
    periods: Array<{
        period_id: string;
        allocated_amount: number;
        effective_amount?: number | null;
        spent: number;
    }>;
}
export interface WidgetLeftToSpend {
    available: number;
    budgeted: number;
    spent: number;
    over: boolean;
    hasBudgets: boolean;
}
export interface WidgetSnapshotPayload {
    v: number;
    asOfMs: number;
    defaultCadence: string;
    cadences: Record<string, {
        periodLabel: string;
        leftToSpend: WidgetLeftToSpend;
    }>;
}
/** Home Budgets card totals for one period. PURE. */
export declare function compute_left_to_spend(budgets: WidgetBudgetInput[], period_id: string): WidgetLeftToSpend;
/** "Oct", "Week of Sep 28", "Oct 1–15" (UTC), like the app. PURE. */
export declare function short_period_label(cadence: string, start_ms: number, end_ms: number): string;
/** The single-cadence snapshot the widget endpoint returns. PURE (time injected). */
export declare function build_widget_snapshot(input: {
    cadence: string;
    period_id: string;
    start_ms: number;
    end_ms: number;
    budgets: WidgetBudgetInput[];
    now_ms: number;
}): WidgetSnapshotPayload;
//# sourceMappingURL=widget_snapshot.service.d.ts.map