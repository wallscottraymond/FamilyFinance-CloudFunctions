"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIDGET_SNAPSHOT_VERSION = void 0;
exports.compute_left_to_spend = compute_left_to_spend;
exports.short_period_label = short_period_label;
exports.build_widget_snapshot = build_widget_snapshot;
/* eslint-disable @typescript-eslint/naming-convention */
// The snapshot is a camelCase WIRE FORMAT shared with the mobile app and the Swift widget
// (mapper-style exception to the snake_case rule).
exports.WIDGET_SNAPSHOT_VERSION = 1;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Home Budgets card totals for one period. PURE. */
function compute_left_to_spend(budgets, period_id) {
    var _a, _b, _c, _d;
    let budgeted = 0;
    let spent = 0;
    for (const b of budgets) {
        const p = (_a = b.periods.find((pp) => pp.period_id === period_id)) !== null && _a !== void 0 ? _a : b.periods[0];
        const allocated = (_b = p === null || p === void 0 ? void 0 : p.allocated_amount) !== null && _b !== void 0 ? _b : 0;
        budgeted += (_c = p === null || p === void 0 ? void 0 : p.effective_amount) !== null && _c !== void 0 ? _c : allocated;
        spent += (_d = p === null || p === void 0 ? void 0 : p.spent) !== null && _d !== void 0 ? _d : 0;
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
/** "Oct", "Week of Sep 28", "Oct 1–15" (UTC), like the app. PURE. */
function short_period_label(cadence, start_ms, end_ms) {
    const s = new Date(start_ms);
    const e = new Date(end_ms);
    const mon = MONTHS[s.getUTCMonth()];
    if (cadence === "weekly")
        return `Week of ${mon} ${s.getUTCDate()}`;
    if (cadence === "bi_monthly")
        return `${mon} ${s.getUTCDate()}–${e.getUTCDate()}`;
    return mon !== null && mon !== void 0 ? mon : "";
}
/** The single-cadence snapshot the widget endpoint returns. PURE (time injected). */
function build_widget_snapshot(input) {
    return {
        v: exports.WIDGET_SNAPSHOT_VERSION,
        asOfMs: input.now_ms,
        defaultCadence: input.cadence,
        cadences: {
            [input.cadence]: {
                periodLabel: short_period_label(input.cadence, input.start_ms, input.end_ms),
                leftToSpend: compute_left_to_spend(input.budgets, input.period_id),
            },
        },
    };
}
//# sourceMappingURL=widget_snapshot.service.js.map