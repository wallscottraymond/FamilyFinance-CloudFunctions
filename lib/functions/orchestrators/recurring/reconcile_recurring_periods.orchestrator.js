"use strict";
/**
 * Reconcile Recurring Periods Orchestrator
 * (Recurring-Period-Reconciliation Phase 3e — the `reconcile_recurring_period` job body)
 *
 * Recomputes a recurring doc's period paid/received status from its currently-
 * linked splits, invalidation-style: resolve → align (domain) → compute (domain)
 * → write (repo). Idempotent — every run recomputes from the live links, so
 * removing/un-matching a split naturally reverts a period's status.
 *
 * @module orchestrators/recurring/reconcile_recurring_periods
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_recurring_reconciliation = compute_recurring_reconciliation;
exports.reconcile_recurring_periods_orchestrator = reconcile_recurring_periods_orchestrator;
const reconciliation_fingerprint_1 = require("../../domain/recurring/reconciliation_fingerprint");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const period_reconciliation_resolver_1 = require("../../resolvers/recurring/period_reconciliation.resolver");
const period_reconciliation_service_1 = require("../../domain/recurring/period_reconciliation.service");
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
const recurring_suppression_service_1 = require("../../domain/recurring/recurring_suppression.service");
/**
 * Resolve the recurring doc's periods + linked splits, align each split to one period per type and
 * compute every period's result. Reads only (null when it has no periods). The job writes the
 * results whose fingerprint changed; the F1 repair script (scripts/repair-recurring-received.ts)
 * compares them to the stored totals instead.
 */
async function compute_recurring_reconciliation(ctx, input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    // 1. Resolve: active periods + sign-normalized linked splits.
    const resolved = await (0, period_reconciliation_resolver_1.resolve_recurring_reconciliation)(ctx, {
        recurring_id: input.recurring_id,
        recurring_type: input.recurring_type,
    });
    if (resolved.periods.length === 0 && ((_a = resolved.inactive_periods) !== null && _a !== void 0 ? _a : []).length === 0) {
        return null;
    }
    // 2. A recurring doc generates periods of MULTIPLE types (monthly / weekly /
    //    bi_monthly) that overlap in time. A payment must reconcile ONE period
    //    PER TYPE — so it shows paid/received in every period-type view (mirrors
    //    budget spend across overlapping periods). Group by type, align within each.
    const periods_by_type = new Map();
    for (const p of resolved.periods) {
        const arr = (_b = periods_by_type.get(p.period_type)) !== null && _b !== void 0 ? _b : [];
        arr.push(p);
        periods_by_type.set(p.period_type, arr);
    }
    const inactive_by_type = new Map();
    for (const p of (_c = resolved.inactive_periods) !== null && _c !== void 0 ? _c : []) {
        const arr = (_d = inactive_by_type.get(p.period_type)) !== null && _d !== void 0 ? _d : [];
        arr.push(p);
        inactive_by_type.set(p.period_type, arr);
    }
    const intervals = resolved.removal_intervals;
    const by_period = new Map();
    // D28: per period, the suppressed-month due dates an early payment carried in (moved to the
    // payment date), and the inactive periods that now hold one (turned on, marked carryActive).
    const carried_into = new Map();
    const activate = new Map();
    for (const type of new Set([...periods_by_type.keys(), ...inactive_by_type.keys()])) {
        const type_periods = (_e = periods_by_type.get(type)) !== null && _e !== void 0 ? _e : [];
        // Round 5 defect 5: an inactive period is turned on only when the removal is WHY it is off
        // (suppressed as a whole, no occurrence in a kept month) — one off for any other reason stays
        // off, and the payment is placed as any other.
        const off_by_id = new Map(((_f = inactive_by_type.get(type)) !== null && _f !== void 0 ? _f : []).map((p) => [p.period_id, p]));
        // D31: a late payment goes to the (active) period holding the occurrence it pays.
        const carriable = (c) => {
            const off = off_by_id.get(c.period_id);
            if (c.late)
                return !off;
            return !off || ((0, recurring_suppression_service_1.is_suppressed_in_period)(intervals, off.end_ms) &&
                !(0, recurring_suppression_service_1.is_stored_period_active)(intervals, off.end_ms, off.occurrence_due_dates_ms));
        };
        const carried = (intervals === null || intervals === void 0 ? void 0 : intervals.length)
            ? (0, period_reconciliation_service_1.carried_payments)([...type_periods, ...((_g = inactive_by_type.get(type)) !== null && _g !== void 0 ? _g : [])], resolved.splits, intervals)
                .filter(carriable)
            : [];
        const carried_idx = new Set(carried.map((c) => c.index));
        for (const c of carried) {
            const s = resolved.splits[c.index];
            const arr = (_h = by_period.get(c.period_id)) !== null && _h !== void 0 ? _h : [];
            arr.push({ transaction_id: s.transaction_id, split_id: s.split_id, amount: s.amount, is_pending: s.is_pending, date_ms: s.date_ms });
            by_period.set(c.period_id, arr);
            if (c.late)
                continue; // D31: its occurrence keeps its due date (a kept month's)
            const list = (_j = carried_into.get(c.period_id)) !== null && _j !== void 0 ? _j : [];
            list.push({ due_ms: c.carried_due_ms, payment_ms: s.date_ms });
            carried_into.set(c.period_id, list);
            const off = off_by_id.get(c.period_id);
            if (off)
                activate.set(off.period_id, off);
        }
        if (type_periods.length === 0)
            continue;
        // Tolerance scales with THIS type's period length.
        const sample_len = type_periods[0].end_ms - type_periods[0].start_ms;
        const opts = {
            tolerance_ms: (0, period_reconciliation_service_1.default_tolerance_ms)(0, sample_len),
            early_window_ms: (0, period_reconciliation_service_1.default_early_window_ms)(0, sample_len),
        };
        const align_periods = type_periods.map((p) => ({
            period_id: p.period_id,
            start_ms: p.start_ms,
            end_ms: p.end_ms,
            due_date_ms: p.due_date_ms,
        }));
        for (const [i, s] of resolved.splits.entries()) {
            if (carried_idx.has(i))
                continue; // D28: carried above
            const aligned = (0, period_reconciliation_service_1.align_transaction_to_period)(s.date_ms, align_periods, opts);
            if (!aligned.period_id)
                continue;
            const arr = (_k = by_period.get(aligned.period_id)) !== null && _k !== void 0 ? _k : [];
            arr.push({
                transaction_id: s.transaction_id,
                split_id: s.split_id,
                amount: s.amount,
                is_pending: s.is_pending,
                date_ms: s.date_ms,
            });
            by_period.set(aligned.period_id, arr);
        }
    }
    // 3. Compute status for EVERY active period (periods that lost their split
    //    recompute to `none` — un-match reverts for free).
    const to_reconcile = [...resolved.periods, ...activate.values()];
    const results = to_reconcile.map((p) => {
        var _a;
        return (0, period_reconciliation_service_1.compute_period_reconciliation)({
            period_id: p.period_id,
            start_ms: p.start_ms,
            end_ms: p.end_ms,
            is_variable_amount: p.is_variable_amount,
            amount_per_occurrence: p.amount_per_occurrence,
            // D28: a carried occurrence is expected at its payment's date (in this period).
            occurrence_due_dates_ms: with_carried(p.occurrence_due_dates_ms, carried_into.get(p.period_id)),
        }, (_a = by_period.get(p.period_id)) !== null && _a !== void 0 ? _a : [], 
        // "Mark as paid / received": occurrences no real payment settled but the user marked.
        resolved.manual_marks);
    });
    return { resolved, to_reconcile, results, carried_into, activate, intervals };
}
async function reconcile_recurring_periods_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "reconcile_recurring_periods");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        // 1-3. Resolve, align, compute (shared with the repair script).
        const computed = await compute_recurring_reconciliation(ctx, input);
        perf.reads++;
        if (!computed) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { periods_reconciled: 0, success: true };
        }
        const { resolved, to_reconcile, results, carried_into, activate, intervals } = computed;
        // 4. Write only the periods whose result CHANGED (was: every active period, every time —
        //    hundreds of rewrites per stream per reconcile).
        const stored = new Map(to_reconcile.map((p) => [p.period_id, p.stored_fingerprint]));
        const changed = results.filter((r) => stored.get(r.period_id) !== (0, reconciliation_fingerprint_1.fingerprint_result)(r));
        const writes = input.recurring_type === "outflow"
            ? await outflow_period_repo_1.outflow_period_repo.update_reconciliation(ctx, changed)
            : await inflow_period_repo_1.inflow_period_repo.update_reconciliation(ctx, changed);
        perf.writes += writes.length;
        // D28: periods turned on by a carried payment; marked ones that no longer hold one turned off.
        // A marked period active again by the month rule itself (restored) only loses the mark.
        const released = resolved.periods.filter((p) => p.carry_active && !carried_into.has(p.period_id));
        const by_rule = (p) => (0, recurring_suppression_service_1.is_stored_period_active)(intervals, p.end_ms, p.occurrence_due_dates_ms);
        const carry_off = released.filter((p) => !by_rule(p)).map((p) => p.period_id);
        const carry_clear = released.filter(by_rule).map((p) => p.period_id);
        const carry_on = [...activate.keys()];
        if (carry_on.length + carry_off.length + carry_clear.length > 0) {
            perf.writes += input.recurring_type === "outflow"
                ? await outflow_period_repo_1.outflow_period_repo.set_carry_active(ctx, carry_on, carry_off, carry_clear)
                : await inflow_period_repo_1.inflow_period_repo.set_carry_active(ctx, carry_on, carry_off, carry_clear);
        }
        (0, observability_1.log_operation_success)(span, input.user_id);
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "reconcile_recurring_periods",
            status: "success",
            context: {
                recurring_id: input.recurring_id,
                recurring_type: input.recurring_type,
                active_periods: resolved.periods.length,
                linked_splits: resolved.splits.length,
                periods_reconciled: results.length,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        console.log(`[${ctx.trace_id}] reconcile_recurring_periods: ${input.recurring_type}=${input.recurring_id}, ` +
            `periods=${results.length}, splits=${resolved.splits.length}`);
        return { periods_reconciled: results.length, success: true };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "RECONCILE_RECURRING_PERIODS_FAILED" });
        throw error;
    }
}
/** D28: a period's due dates with each carried occurrence moved to its payment's date. PURE. */
function with_carried(due_ms, carried) {
    if (!(carried === null || carried === void 0 ? void 0 : carried.length))
        return due_ms;
    const moved = new Set(carried.map((c) => c.due_ms));
    return [...due_ms.filter((d) => !moved.has(d)), ...carried.map((c) => c.payment_ms)];
}
//# sourceMappingURL=reconcile_recurring_periods.orchestrator.js.map