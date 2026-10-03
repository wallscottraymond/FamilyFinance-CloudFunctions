"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.WIDGET_DATA_VERSION = void 0;
exports.short_period_label = short_period_label;
exports.occurrences_of = occurrences_of;
exports.compute_left_to_spend = compute_left_to_spend;
exports.compute_period_summary = compute_period_summary;
exports.compute_bills_due_soon = compute_bills_due_soon;
/* eslint-disable @typescript-eslint/naming-convention */
// Widget payloads are a camelCase WIRE FORMAT shared with the Swift widget (mapper-style
// exception to the snake_case rule).
exports.WIDGET_DATA_VERSION = 2;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BILL_ITEMS = 6;
// ---- Shared helpers (mirror mobile) ----------------------------------------------------------
/** "Oct", "Week of Sep 28", "Oct 1–15" (UTC) — mobile `shortPeriodLabel`. */
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
/** Mobile `occurrencesOf`: placed occurrences, else one aggregate row from the group. */
function occurrences_of(g) {
    var _a, _b, _c, _d, _e;
    if (g.occurrences && g.occurrences.length > 0)
        return g.occurrences;
    const count = (_a = g.count_in_period) !== null && _a !== void 0 ? _a : 0;
    if (count <= 0)
        return [];
    return [
        {
            due_ms: (_c = (_b = g.first_due_ms) !== null && _b !== void 0 ? _b : g.next_unpaid_due_ms) !== null && _c !== void 0 ? _c : 0,
            paid: ((_d = g.count_paid) !== null && _d !== void 0 ? _d : 0) >= count,
            amount: (_e = g.total_due) !== null && _e !== void 0 ? _e : 0,
        },
    ];
}
/** Mobile `mapResult`'s due-group lookup for a period. */
function due_group(r, period_id) {
    return r.groups.find((g) => g.period_id === period_id && g.is_due_period);
}
/** The budget's derive period for the viewed period (mobile `mapResult`: match, else first). */
function budget_period(b, period_id) {
    var _a;
    return (_a = b.periods.find((p) => p.period_id === period_id)) !== null && _a !== void 0 ? _a : b.periods[0];
}
// ---- Left to spend ---------------------------------------------------------------------------
/** Home Budgets card totals (`computeBudgetSectionTotals`). PURE. */
function compute_left_to_spend(budgets, period_id, include_everything_else = true) {
    var _a, _b, _c;
    let budgeted = 0;
    let spent = 0;
    for (const b of budgets) {
        if (!include_everything_else && b.is_everything_else)
            continue;
        const p = budget_period(b, period_id);
        const allocated = (_a = p === null || p === void 0 ? void 0 : p.allocated_amount) !== null && _a !== void 0 ? _a : 0;
        budgeted += (_b = p === null || p === void 0 ? void 0 : p.effective_amount) !== null && _b !== void 0 ? _b : allocated;
        spent += (_c = p === null || p === void 0 ? void 0 : p.spent) !== null && _c !== void 0 ? _c : 0;
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
function compute_period_summary(derived, period_id, goals) {
    var _a, _b;
    const recurring = (items) => {
        let planned = 0;
        let actual = 0;
        let entries = 0;
        for (const r of items) {
            const g = due_group(r, period_id);
            if (!g)
                continue;
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
        if (b.is_everything_else)
            continue;
        real_budgets += 1;
        const p = budget_period(b, period_id);
        budgets_planned += (_a = p === null || p === void 0 ? void 0 : p.allocated_amount) !== null && _a !== void 0 ? _a : 0; // Summary uses totalAllocated (not effective)
        budgets_spent += (_b = p === null || p === void 0 ? void 0 : p.spent) !== null && _b !== void 0 ? _b : 0;
    }
    const active_goals = goals.filter((g) => g.status === "active");
    const goals_planned = active_goals.reduce((s, g) => s + (g.targetForPeriod || 0), 0);
    const goals_actual = active_goals.reduce((s, g) => s + (g.progressForPeriod || 0), 0);
    return {
        income: { planned: income.planned, actual: income.actual },
        bills: { planned: bills.planned, actual: bills.actual },
        budgets: { planned: budgets_planned, actual: budgets_spent },
        goals: { planned: goals_planned, actual: goals_actual },
        isEmpty: income.entries === 0 &&
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
function compute_bills_due_soon(periods, now_ms, lookahead_days) {
    const today_start = Math.floor(now_ms / DAY_MS) * DAY_MS; // occurrence dates are UTC days
    const horizon = today_start + (lookahead_days + 1) * DAY_MS - 1;
    const seen = new Set();
    const items = [];
    for (const { period_id, bills } of periods) {
        for (const r of bills) {
            const g = due_group(r, period_id);
            if (!g)
                continue;
            for (const o of occurrences_of(g)) {
                if (o.paid || o.due_ms > horizon)
                    continue;
                const key = `${r.recurring_id}:${o.due_ms}`;
                if (seen.has(key))
                    continue;
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
//# sourceMappingURL=widget_snapshot.service.js.map