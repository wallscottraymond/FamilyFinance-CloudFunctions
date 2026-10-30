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
 *  - Budget lines   = one row per budget like the period page's budget rows (effective limit,
 *                     spent, remaining), Everything-Else last.
 *  - Budget txns    = the budget's derive_budget_transactions rows (Budget Detail list), newest
 *                     first, counted/refund only (ignored rows don't count toward the budget).
 *  - Bills due soon = unpaid bill occurrences (same `occurrencesOf` rule) due by now+lookahead.
 *  - Labels         = mobile `shortPeriodLabel`.
 *
 * @module domain/widgets/widget_snapshot
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_RECENT_TXNS = exports.WIDGET_LOGIC_REVISION = exports.WIDGET_DATA_VERSION = void 0;
exports.versioned_for_kind = versioned_for_kind;
exports.short_period_label = short_period_label;
exports.occurrences_of = occurrences_of;
exports.compute_left_to_spend = compute_left_to_spend;
exports.compute_budget_lines = compute_budget_lines;
exports.is_recent_transfer = is_recent_transfer;
exports.select_recent_transactions = select_recent_transactions;
exports.recent_bill_ids = recent_bill_ids;
exports.compute_recent_transactions = compute_recent_transactions;
exports.compute_recent_budget_transactions = compute_recent_budget_transactions;
exports.compute_period_summary = compute_period_summary;
exports.compute_bills_due_soon = compute_bills_due_soon;
/* eslint-disable @typescript-eslint/naming-convention */
// Widget payloads are a camelCase WIRE FORMAT shared with the Swift widget (mapper-style
// exception to the snake_case rule).
exports.WIDGET_DATA_VERSION = 2;
/**
 * Per-kind LOGIC revision, folded into the version a widget compares ("have"). A widget skips
 * re-downloading while the version is unchanged, and the view version only moves when the user's
 * data does, so a server-side logic fix would otherwise not reach a widget that already cached an
 * answer. Raise a kind's number whenever its output changes for the same data; the next deploy
 * then refreshes those widgets. Kinds not listed are 0 (their versions are unchanged).
 * recent: 2 = Me shows every transaction on your own accounts (was the period page's Me scope).
 */
exports.WIDGET_LOGIC_REVISION = { recent: 2 };
/** The version a widget of `kind` compares: the view version plus that kind's logic revision. */
function versioned_for_kind(version, kind) {
    var _a;
    const revision = (_a = exports.WIDGET_LOGIC_REVISION[kind]) !== null && _a !== void 0 ? _a : 0;
    return revision === 0 ? version : (version + revision) % Number.MAX_SAFE_INTEGER;
}
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
// ---- Budget lines + transactions -----------------------------------------------------------
/** One row per budget (period page order, Everything-Else last). PURE. */
function compute_budget_lines(budgets, period_id) {
    const lines = budgets.map((b, i) => {
        var _a, _b, _c, _d, _e;
        const p = budget_period(b, period_id);
        const allocated = (_a = p === null || p === void 0 ? void 0 : p.allocated_amount) !== null && _a !== void 0 ? _a : 0;
        const budgeted = (_b = p === null || p === void 0 ? void 0 : p.effective_amount) !== null && _b !== void 0 ? _b : allocated;
        const spent = (_c = p === null || p === void 0 ? void 0 : p.spent) !== null && _c !== void 0 ? _c : 0;
        const available = budgeted - spent;
        return {
            order: i,
            line: {
                id: (_d = b.budget_id) !== null && _d !== void 0 ? _d : `budget-${i}`,
                name: (_e = b.name) !== null && _e !== void 0 ? _e : "Budget",
                isEverythingElse: b.is_everything_else,
                budgeted,
                spent,
                available,
                over: available < 0,
            },
        };
    });
    lines.sort((a, b) => Number(a.line.isEverythingElse) - Number(b.line.isEverythingElse) || a.order - b.order);
    return lines.map((l) => l.line);
}
/** Most recent transactions that count toward a budget (newest first). PURE. */
// ---- Recent transactions (mirrors the app's Home card with "Hide transfers" on) --------------
/** Most rows any size shows (large). */
exports.MAX_RECENT_TXNS = 9;
function splits_of(data) {
    return Array.isArray(data.splits) ? data.splits : [];
}
function millis_of(v) {
    const t = v;
    return typeof (t === null || t === void 0 ? void 0 : t.toMillis) === "function" ? t.toMillis() : 0;
}
/** The app's `transactionDate || dateTransacted || date`. */
function txn_date_ms(data) {
    return millis_of(data.transactionDate) || millis_of(data.dateTransacted) || millis_of(data.date);
}
/** The app's `isTransferTransaction`: the stored matched-pair role decides ("internal" between your
 *  own accounts, "external" unpaired); without one, every split must be a transfer category. */
function is_recent_transfer(data) {
    const role = data.transferRole;
    if (typeof role === "string" && role.length > 0) {
        return role === "internal" || role === "external";
    }
    const splits = splits_of(data);
    if (splits.length === 0)
        return false;
    return splits.every((s) => { var _a, _b; return /^TRANSFER_(IN|OUT)/.test(String((_b = (_a = s.plaidDetailedCategory) !== null && _a !== void 0 ? _a : s.plaidPrimaryCategory) !== null && _b !== void 0 ? _b : "")); });
}
/**
 * The rows the widget shows, newest first: what the app's Home card lists (not soft-deleted, has an
 * owner and at least one split) minus transfers, de-duplicated by id. PURE.
 */
function select_recent_transactions(rows, limit = exports.MAX_RECENT_TXNS) {
    const seen = new Set();
    return rows
        .filter((r) => {
        if (seen.has(r.id))
            return false;
        seen.add(r.id);
        const d = r.data;
        if (d.isActive === false || d.isDeleted === true)
            return false;
        if (!d.userId || splits_of(d).length === 0)
            return false;
        return !is_recent_transfer(d);
    })
        .sort((a, b) => txn_date_ms(b.data) - txn_date_ms(a.data))
        .slice(0, limit);
}
/** The bill ids the selected rows paid (a split not ignored, linked to an outflow). PURE. */
function recent_bill_ids(rows) {
    const ids = new Set();
    for (const r of rows) {
        for (const s of splits_of(r.data)) {
            const outflow_id = s.outflowId;
            if (s.isIgnored !== true && typeof outflow_id === "string" && outflow_id)
                ids.add(outflow_id);
        }
    }
    return [...ids];
}
/** A bill's display name, as the app's bill rows name it. PURE. */
function bill_name(doc, fallback) {
    var _a;
    const pick = [doc === null || doc === void 0 ? void 0 : doc.userCustomName, doc === null || doc === void 0 ? void 0 : doc.merchantName, doc === null || doc === void 0 ? void 0 : doc.description, fallback].find((v) => typeof v === "string" && v.trim().length > 0);
    return (_a = pick) !== null && _a !== void 0 ? _a : "Bill";
}
/** The selected rows as the widget wire format. `bills` = outflow docs by id. PURE. */
function compute_recent_transactions(rows, bills) {
    return rows.map(({ id, data }) => {
        var _a, _b, _c;
        const splits = splits_of(data);
        const split_total = splits.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
        const total = splits.length > 0 ? split_total : Number(data.amount) || 0;
        const income = typeof data.type === "string" && data.type ? data.type === "income" : total < 0;
        const metadata = ((_a = data.metadata) !== null && _a !== void 0 ? _a : {});
        const name = [data.merchantName, metadata.plaidMerchantName, data.name, data.description].find((v) => typeof v === "string" && v.trim().length > 0);
        const bill_split = splits.find((s) => s.isIgnored !== true && typeof s.outflowId === "string" && s.outflowId);
        const primary = (_b = splits.find((s) => s.isDefault === true)) !== null && _b !== void 0 ? _b : splits[0];
        const budget_names = [
            ...new Set(splits
                .map((s) => s.budgetName)
                .filter((n) => typeof n === "string" && n.trim().length > 0)),
        ];
        const primary_name = primary === null || primary === void 0 ? void 0 : primary.budgetName;
        const primary_budget = typeof primary_name === "string" && primary_name.trim() ? primary_name : null;
        return {
            id,
            accountId: typeof data.accountId === "string" ? data.accountId : "",
            name: name !== null && name !== void 0 ? name : "Transaction",
            dateMs: txn_date_ms(data),
            amount: Math.abs(total),
            income,
            pending: data.isPending === true || data.pending === true || data.transactionStatus === "pending",
            bill: bill_split
                ? bill_name(bills.get(bill_split.outflowId), bill_split.outflowDescription)
                : null,
            budget: (_c = primary_budget !== null && primary_budget !== void 0 ? primary_budget : budget_names[0]) !== null && _c !== void 0 ? _c : (income ? "Income" : null),
            moreBudgets: Math.max(0, budget_names.length - 1),
        };
    });
}
function compute_recent_budget_transactions(rows, limit = 5) {
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