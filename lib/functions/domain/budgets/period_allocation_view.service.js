"use strict";
/**
 * THE period-page allocation rule (Transaction-Integrity X10 — "This Period Only" for any view).
 *
 * The period page builds EVERY view's budget allocation (monthly, weekly, bi-monthly buckets) from
 * the budget's MONTHLY `budget_periods` docs only (derive's home for every budget). A bucket gets:
 *
 *   Σ over the monthly periods of  base ÷ month days × days the bucket overlaps the month
 * + Σ over each month's `periodAdjustments` of
 *                                  adj.amount × days(adj ∩ bucket) ÷ days(adj)
 *
 * An adjustment is the "This Period Only" extra dollars for ONE edited view period (its periodId,
 * e.g. "2031W28"), stored on the monthly doc(s) it overlaps, clipped to that month. The edited
 * bucket therefore gets the whole adjustment and every other bucket that doesn't overlap the edited
 * period gets none of it — whatever the budget's cadence or the edited period's type.
 *
 * Used by the period page (budget_view.service), the "This Period Only" callable (to know what the
 * page shows before the edit) and its unit tests — one rule, so the page always shows what was
 * typed. Day counting is UTC-inclusive. PURE.
 *
 * @module domain/budgets/period_allocation_view
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.utc_day_index = utc_day_index;
exports.days_inclusive = days_inclusive;
exports.overlap_days = overlap_days;
exports.round2 = round2;
exports.bucket_allocation = bucket_allocation;
exports.split_adjustment_by_month = split_adjustment_by_month;
exports.rebase_adjustments = rebase_adjustments;
exports.rebase_reallocated_periods = rebase_reallocated_periods;
/** UTC day index (days since epoch) for a timestamp. PURE. */
function utc_day_index(ms) {
    const d = new Date(ms);
    return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}
/** Inclusive UTC-normalized day count for a range. PURE. */
function days_inclusive(start_ms, end_ms) {
    return utc_day_index(end_ms) - utc_day_index(start_ms) + 1;
}
/** Inclusive UTC-day overlap (in days) between two ranges. 0 if disjoint. PURE. */
function overlap_days(a_start_ms, a_end_ms, b_start_ms, b_end_ms) {
    const start = Math.max(utc_day_index(a_start_ms), utc_day_index(b_start_ms));
    const end = Math.min(utc_day_index(a_end_ms), utc_day_index(b_end_ms));
    return end >= start ? end - start + 1 : 0;
}
/** Round to 2 decimals. PURE. */
function round2(value) {
    return Math.round(value * 100) / 100;
}
/** An adjustment's share of a bucket, its range clipped to its month. PURE. */
function adjustment_in_bucket(adj, mp, start_ms, end_ms) {
    const a_start = Math.max(adj.start_ms, mp.start_ms);
    const a_end = Math.min(adj.end_ms, mp.end_ms);
    if (utc_day_index(a_end) < utc_day_index(a_start))
        return 0;
    const adj_days = days_inclusive(a_start, a_end);
    const days = overlap_days(a_start, a_end, start_ms, end_ms);
    return days === 0 ? 0 : (adj.amount * days) / adj_days;
}
/**
 * The page's allocation for the bucket [start_ms, end_ms] (inclusive): `allocated` (the budget
 * amount the page shows) and `effective` (incl. the monthly rollover), each rounded to cents.
 * PURE.
 */
function bucket_allocation(monthly_periods, start_ms, end_ms) {
    var _a;
    let allocated = 0;
    let effective = 0;
    for (const mp of monthly_periods) {
        const days = overlap_days(mp.start_ms, mp.end_ms, start_ms, end_ms);
        if (days === 0)
            continue;
        const mp_days = days_inclusive(mp.start_ms, mp.end_ms);
        if (mp_days <= 0)
            continue;
        allocated += (mp.allocated_amount / mp_days) * days;
        effective += (mp.effective_amount / mp_days) * days;
        for (const adj of (_a = mp.adjustments) !== null && _a !== void 0 ? _a : []) {
            const extra = adjustment_in_bucket(adj, mp, start_ms, end_ms);
            allocated += extra;
            effective += extra;
        }
    }
    return { allocated: round2(allocated), effective: round2(effective) };
}
/**
 * Split an edited period's adjustment `amount` across the months it overlaps, by overlap days,
 * cents-exact (the parts sum to `amount`; the last part takes the rounding remainder). Each part's
 * range is the edited period clipped to that month. `months` are the monthly periods' bounds.
 * PURE.
 */
function split_adjustment_by_month(period_id, start_ms, end_ms, amount, months) {
    const parts = months
        .map((m, month_index) => ({
        month_index,
        start_ms: Math.max(start_ms, m.start_ms),
        end_ms: Math.min(end_ms, m.end_ms),
        days: overlap_days(start_ms, end_ms, m.start_ms, m.end_ms),
    }))
        .filter((p) => p.days > 0)
        .sort((a, b) => a.start_ms - b.start_ms);
    const total_days = parts.reduce((s, p) => s + p.days, 0);
    if (total_days === 0)
        return [];
    let assigned = 0;
    return parts.map((p, i) => {
        const part = i === parts.length - 1 ? round2(amount - assigned) : round2((amount * p.days) / total_days);
        assigned = round2(assigned + part);
        return {
            month_index: p.month_index,
            adjustment: { period_id, start_ms: p.start_ms, end_ms: p.end_ms, amount: part },
        };
    });
}
/**
 * Keep the user's custom periods ABSOLUTE when a monthly doc's BASE allocation changes (a budget
 * amount change re-allocates the month). An adjustment is a delta on top of the month's
 * pro-rated base, so without this the page amount of its range would drift with the base. The
 * adjustments are rebased so the page shows the same figure for EVERY custom range:
 *
 *  - an adjustment overlapping no other one (the usual case): shift by the base change over its
 *    days, rounding each pro-rated term the way the page does (exact to the cent):
 *      amount' = round2(amount + round2(old_base × d ÷ D) − round2(new_base × d ÷ D))
 *  - adjustments that OVERLAP (a custom month + a custom week inside it, a half-month + a week):
 *    each one's page figure includes the others' share of its days, so they're solved TOGETHER —
 *    for each range i: Σ_j x_j · overlap(i, j) ÷ days(j) = Δ · days(i) ÷ D (x = the change in
 *    amount, Δ = old_base − new_base). Shifting each independently would count the base change
 *    twice on the overlap (a custom week inside a custom month would go negative).
 *
 * (d = the adjustment's days inside the month, D = the month's days.) `old_base` / `new_base`
 * are the doc's base as the page reads it (legacy override ?? allocation). PURE.
 */
function rebase_adjustments(adjustments, old_base, new_base, month_start_ms, month_end_ms) {
    if (old_base === new_base)
        return adjustments;
    const month_days = days_inclusive(month_start_ms, month_end_ms);
    if (month_days <= 0)
        return adjustments;
    const delta = old_base - new_base;
    const in_month = (a) => overlap_days(a.start_ms, a.end_ms, month_start_ms, month_end_ms);
    const own_days = (a) => days_inclusive(a.start_ms, a.end_ms);
    const ov = (a, b) => overlap_days(Math.max(a.start_ms, month_start_ms), Math.min(a.end_ms, month_end_ms), b.start_ms, b.end_ms);
    // Group the in-month adjustments by overlap (connected components).
    const idx = adjustments.map((a, i) => i).filter((i) => in_month(adjustments[i]) > 0);
    const group_of = new Map();
    const groups = [];
    for (const i of idx) {
        if (group_of.has(i))
            continue;
        const group = [i];
        group_of.set(i, groups.length);
        for (let k = 0; k < group.length; k++) {
            for (const j of idx) {
                if (!group_of.has(j) && ov(adjustments[group[k]], adjustments[j]) > 0) {
                    group_of.set(j, groups.length);
                    group.push(j);
                }
            }
        }
        groups.push(group);
    }
    const out = adjustments.map((a) => (Object.assign({}, a)));
    for (const group of groups) {
        if (group.length === 1) {
            const a = adjustments[group[0]];
            const d = in_month(a);
            const shift = round2((old_base * d) / month_days) - round2((new_base * d) / month_days);
            out[group[0]].amount = round2(a.amount + shift);
            continue;
        }
        // Solve M x = s with Gaussian elimination (partial pivoting); M_ij = overlap(i,j) / days(j).
        const n = group.length;
        const m = group.map((gi) => group.map((gj) => ov(adjustments[gi], adjustments[gj]) / own_days(adjustments[gj])));
        const rhs = group.map((gi) => (delta * in_month(adjustments[gi])) / month_days);
        const x = solve_linear(m, rhs);
        for (let k = 0; k < n; k++) {
            const gi = group[k];
            const shift = x
                ? x[k]
                : round2((old_base * in_month(adjustments[gi])) / month_days) -
                    round2((new_base * in_month(adjustments[gi])) / month_days);
            out[gi].amount = round2(adjustments[gi].amount + shift);
        }
    }
    return out;
}
/** Solve a small dense linear system (Gaussian elimination, partial pivoting); null if singular. */
function solve_linear(m, rhs) {
    const n = rhs.length;
    const a = m.map((row, i) => [...row, rhs[i]]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        for (let r = col + 1; r < n; r++) {
            if (Math.abs(a[r][col]) > Math.abs(a[pivot][col]))
                pivot = r;
        }
        if (Math.abs(a[pivot][col]) < 1e-12)
            return null;
        [a[col], a[pivot]] = [a[pivot], a[col]];
        for (let r = 0; r < n; r++) {
            if (r === col)
                continue;
            const f = a[r][col] / a[col][col];
            for (let c = col; c <= n; c++)
                a[r][c] -= f * a[col][c];
        }
    }
    return a.map((row, i) => row[n] / row[i]);
}
/**
 * Apply `rebase_adjustments` to a re-allocation's updates (`compute_reallocated_periods`
 * output): each updated period carrying adjustments gets `period_adjustments` rebased from its
 * old base to its new one, and every update's `remaining` is the page's amount
 * (override ?? allocation + adjustments) + rollover − spent. Used by BOTH re-allocation paths
 * (update_budget → process_budget_updated, and "All Periods Forward"). PURE.
 */
function rebase_reallocated_periods(periods, updates) {
    const by_id = new Map(periods.map((p) => [p.id, p]));
    return updates.map((u) => {
        var _a, _b;
        const p = by_id.get(u.id);
        if (!p)
            return u;
        const old_base = (_a = p.override) !== null && _a !== void 0 ? _a : p.allocated_amount;
        const new_base = (_b = p.override) !== null && _b !== void 0 ? _b : u.allocated_amount;
        const adjustments = p.adjustments.length > 0
            ? rebase_adjustments(p.adjustments, old_base, new_base, p.start_ms, p.end_ms)
            : p.adjustments;
        const adj_total = adjustments.reduce((s, a) => s + a.amount, 0);
        const remaining = round2(new_base + adj_total + p.rolled_over_amount - p.spent);
        return p.adjustments.length > 0
            ? Object.assign(Object.assign({}, u), { remaining, period_adjustments: adjustments }) : Object.assign(Object.assign({}, u), { remaining });
    });
}
//# sourceMappingURL=period_allocation_view.service.js.map