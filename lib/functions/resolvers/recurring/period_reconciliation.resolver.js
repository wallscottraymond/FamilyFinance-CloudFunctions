"use strict";
/**
 * Period Reconciliation Resolver (Recurring-Period-Reconciliation Phase 3c)
 *
 * READ-ONLY. Loads everything the pure domain needs to reconcile a recurring
 * doc's periods: the recurring doc (for its `transactionIds` inbound list + the
 * variable-amount flag), its ACTIVE periods, and the linked splits.
 *
 * ⚠️ Honors the domain CONTRACT: `amount` is sign-normalized so positive =
 * toward paid/received (refunds negative). Ignored splits are excluded.
 *
 * @module resolvers/recurring/period_reconciliation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_recurring_reconciliation = resolve_recurring_reconciliation;
const firestore_1 = require("firebase-admin/firestore");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const period_reconciliation_service_1 = require("../../domain/recurring/period_reconciliation.service");
const late_payment_service_1 = require("../../domain/recurring/late_payment.service");
const stream_membership_1 = require("../../domain/recurring/stream_membership");
const reconciliation_fingerprint_1 = require("../../domain/recurring/reconciliation_fingerprint");
function to_ms(value) {
    if (value instanceof firestore_1.Timestamp)
        return value.toMillis();
    if (value && typeof value.toMillis === "function") {
        return value.toMillis();
    }
    return null;
}
/**
 * Whether a recurring item has a VARIABLE amount (utilities, commission, hourly):
 * an explicit `is_variable_amount` flag if present, else derived from the spread
 * between its last and average occurrence amounts (>10% swing ⇒ variable). Variable
 * items reconcile presence-based (any payment), fixed items amount-based.
 */
function derive_is_variable_amount(recurring) {
    var _a, _b;
    if (typeof recurring.is_variable_amount === "boolean") {
        return recurring.is_variable_amount;
    }
    const last = (_a = recurring.last_amount) !== null && _a !== void 0 ? _a : 0;
    const avg = (_b = recurring.average_amount) !== null && _b !== void 0 ? _b : 0;
    if (avg <= 0)
        return false;
    return Math.abs(last - avg) > 0.1 * avg;
}
async function resolve_recurring_reconciliation(ctx, input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const is_outflow = input.recurring_type === "outflow";
    // 1. Recurring doc → inbound transaction list + variable flag.
    const recurring = is_outflow
        ? await outflow_repo_1.outflow_repo.get_by_id(ctx, input.recurring_id, { include_deleted: true })
        : await inflow_repo_1.inflow_repo.get_by_id(ctx, input.recurring_id, { include_deleted: true });
    if (!recurring) {
        return { periods: [], splits: [], manual_marks: {} };
    }
    const transaction_ids = (_a = recurring.transaction_ids) !== null && _a !== void 0 ? _a : [];
    const is_variable_amount = derive_is_variable_amount(recurring);
    // Fallback per-occurrence amount when a period lacks `amountPerOccurrence`.
    const recurring_amount = (_d = (_c = (_b = recurring
        .average_amount) !== null && _b !== void 0 ? _b : recurring.last_amount) !== null && _c !== void 0 ? _c : recurring.amount) !== null && _d !== void 0 ? _d : 0;
    // 2. Active periods (load ids → docs → filter active in memory; no composite index).
    const period_ids = is_outflow
        ? await outflow_period_repo_1.outflow_period_repo.get_by_outflow_id(ctx, input.recurring_id)
        : await inflow_period_repo_1.inflow_period_repo.get_by_inflow_id(ctx, input.recurring_id);
    const period_docs = period_ids.length === 0
        ? []
        : is_outflow
            ? await outflow_period_repo_1.outflow_period_repo.get_by_ids(ctx, period_ids)
            : await inflow_period_repo_1.inflow_period_repo.get_by_ids(ctx, period_ids);
    const to_period = ({ id, data }) => {
        var _a, _b, _c, _d;
        const per_occurrence = Number((_a = data.amountPerOccurrence) !== null && _a !== void 0 ? _a : 0) || recurring_amount;
        let due_dates_ms = Array.isArray(data.occurrenceDueDates)
            ? data.occurrenceDueDates
                .map((d) => to_ms(d))
                .filter((d) => d !== null)
            : [];
        // Fallback for legacy periods missing the array: a single occurrence at the
        // period's due date (the domain still filters to [start,end]). Regeneration
        // backfills the real array; this just covers the transitional window.
        if (due_dates_ms.length === 0) {
            const due = to_ms(data.firstDueDateInPeriod);
            if (due !== null)
                due_dates_ms = [due];
        }
        return Object.assign({ period_id: id, start_ms: (_b = to_ms(data.periodStartDate)) !== null && _b !== void 0 ? _b : 0, end_ms: (_c = to_ms(data.periodEndDate)) !== null && _c !== void 0 ? _c : 0, due_date_ms: to_ms(data.firstDueDateInPeriod), amount_per_occurrence: per_occurrence, occurrence_due_dates_ms: due_dates_ms, is_variable_amount, period_type: String((_d = data.periodType) !== null && _d !== void 0 ? _d : ""), stored_fingerprint: (0, reconciliation_fingerprint_1.fingerprint_stored)(data.reconciliation) }, (data.carryActive === true ? { carry_active: true } : {}));
    };
    const periods = period_docs.filter(({ data }) => data.isActive !== false).map(to_period);
    const removal_intervals_all = recurring.removal_intervals;
    // Round 5 defect 5: only a LIVE item carries (a stale / stopped / hidden one shows nowhere on the
    // period page — nothing of it may be turned on).
    const record_live = recurring.is_active !== false && recurring.is_hidden !== true;
    const inactive_periods = (removal_intervals_all === null || removal_intervals_all === void 0 ? void 0 : removal_intervals_all.length) && record_live
        ? period_docs.filter(({ data }) => data.isActive === false).map(to_period)
        : [];
    // Period-pin support (Bill-Assignment-Two-Stage-Picker): a split that pins a specific period
    // pays THAT period's occurrence — it's placed on the DUE DATE of the bill's first occurrence in
    // the pinned period (so every cadence's period containing that due date sees it paid, as the
    // period page matches it), else the period's midpoint when nothing is due there.
    const midpoint_by_source_period = new Map();
    for (const { data } of period_docs) {
        const sp = data.sourcePeriodId;
        const s = to_ms(data.periodStartDate);
        const e = to_ms(data.periodEndDate);
        if (sp && s !== null && e !== null) {
            const dues = ((_e = data.occurrenceDueDates) !== null && _e !== void 0 ? _e : [])
                .map((d) => to_ms(d))
                .filter((ms) => ms !== null && ms >= s && ms <= e)
                .sort((a, b) => a - b);
            const first_due = (_f = dues[0]) !== null && _f !== void 0 ? _f : to_ms(data.firstDueDateInPeriod);
            midpoint_by_source_period.set(sp, first_due !== null && first_due >= s && first_due <= e ? first_due : Math.floor((s + e) / 2));
        }
    }
    // 3. Linked payments — UNION of two sources, deduped by Firestore doc id:
    //    (a) the DURABLE split link (`splitOutflowIds`/`splitInflowIds`, stamped by
    //        the assignment engine) — survives Plaid's id reissue on pending→posted;
    //        this is the primary, current source.
    //    (b) the recurring's Plaid stream `transactionIds[]` membership — legacy /
    //        covers items the engine hasn't stamped yet. Can be STALE (Plaid lags),
    //        so it's a supplement, not the source of truth.
    //    Each transaction contributes its net countable amount (one payment).
    const splits = [];
    const user_id = (_g = recurring.user_id) !== null && _g !== void 0 ? _g : "";
    const [link_txns, stream_txns] = await Promise.all([
        transaction_repo_1.transaction_repo.get_by_split_recurring_link(ctx, user_id, input.recurring_type, input.recurring_id),
        transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, transaction_ids),
    ]);
    const seen = new Set();
    // Per SPLIT (the period page's rule — `splits_paying_recurring`): the splits linked to this
    // recurring, else (stream member) the splits not taken off by a "remove from bill" / a budget
    // pin. A transaction with no paying split isn't a payment.
    const kind = is_outflow ? "outflow" : "inflow";
    const stream_ids = new Set(stream_txns.map((t) => t.id));
    // Edge money (a transfer crossing the view) pays nothing — as the period page drops its links.
    const paying = (t) => {
        var _a;
        return (0, stream_membership_1.is_edge_money)(t.transferRole)
            ? []
            : (0, stream_membership_1.splits_paying_recurring)((_a = t.splits) !== null && _a !== void 0 ? _a : [], kind, input.recurring_id, stream_ids.has(t.id));
    };
    const txns = [...link_txns, ...stream_txns].filter((t) => {
        const key = t.id;
        if (!key || seen.has(key))
            return false;
        seen.add(key);
        return paying(t).length > 0;
    });
    // A payment in a month the bill / income is removed / paused for pays nothing — it counts as
    // ordinary spending / money in (X9; the engine and the period page apply the same rule).
    const removal_intervals = recurring
        .removal_intervals;
    const release_schedule = is_outflow && (removal_intervals === null || removal_intervals === void 0 ? void 0 : removal_intervals.length)
        ? (0, late_payment_service_1.bill_release_schedule)(recurring)
        : null;
    // D31 / D37: the bill's payments, as the release rule judges a late payment by them.
    const release_bill = release_schedule
        ? {
            schedule: release_schedule,
            payments: txns.filter((t) => t.isActive !== false).map((t) => {
                var _a;
                return ({
                    id: t.id,
                    date_ms: (_a = to_ms(t.transactionDate)) !== null && _a !== void 0 ? _a : 0,
                    amount: (0, period_reconciliation_service_1.compute_countable_split_net)(paying(t), t.id).amount,
                });
            }),
        }
        : null;
    for (const txn of txns) {
        if (txn.isActive === false)
            continue;
        // D31 / D37: except a bill's LATE payment of its last occurrence before the cut-off while
        // that occurrence is still unpaid.
        if ((0, late_payment_service_1.is_payment_released)(removal_intervals, { id: txn.id, date_ms: (_h = to_ms(txn.transactionDate)) !== null && _h !== void 0 ? _h : 0 }, release_bill))
            continue;
        // Honor a manual PERIOD PIN for THIS outflow: align by the pinned period's midpoint
        // (forces placement into that period) instead of the transaction date.
        let date_ms = (_j = to_ms(txn.transactionDate)) !== null && _j !== void 0 ? _j : 0;
        if (is_outflow) {
            const pinned = ((_k = txn.splits) !== null && _k !== void 0 ? _k : []).find((s) => {
                const sp = s;
                return sp.outflowId === input.recurring_id && (0, stream_membership_1.is_manual_period_pin)(sp);
            });
            const pinned_source = pinned === null || pinned === void 0 ? void 0 : pinned.outflowPinnedPeriodId;
            if (pinned_source && midpoint_by_source_period.has(pinned_source)) {
                date_ms = midpoint_by_source_period.get(pinned_source);
            }
        }
        const is_pending = txn.isPending === true;
        // Net countable amount (ignore/refund math) — computed in the domain service
        // so the resolver stays lookup-only (P2-11).
        const { amount, split_id } = (0, period_reconciliation_service_1.compute_countable_split_net)(paying(txn), txn.id);
        splits.push({ transaction_id: txn.id, split_id, amount, is_pending, date_ms });
    }
    console.log(`[${ctx.trace_id}] resolve_recurring_reconciliation: ${input.recurring_type}=${input.recurring_id}, ` +
        `active_periods=${periods.length}, linked_splits=${splits.length}`);
    return Object.assign({ periods, splits, manual_marks: (_l = recurring.manual_settled_occurrences) !== null && _l !== void 0 ? _l : {} }, ((removal_intervals_all === null || removal_intervals_all === void 0 ? void 0 : removal_intervals_all.length) ? { inactive_periods, removal_intervals: removal_intervals_all } : {}));
}
//# sourceMappingURL=period_reconciliation.resolver.js.map