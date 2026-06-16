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
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const is_outflow = input.recurring_type === "outflow";
    // 1. Recurring doc → inbound transaction list + variable flag.
    const recurring = is_outflow
        ? await outflow_repo_1.outflow_repo.get_by_id(ctx, input.recurring_id, { include_deleted: true })
        : await inflow_repo_1.inflow_repo.get_by_id(ctx, input.recurring_id, { include_deleted: true });
    if (!recurring) {
        return { periods: [], splits: [] };
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
    const periods = period_docs
        .filter(({ data }) => data.isActive !== false)
        .map(({ id, data }) => {
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
        return {
            period_id: id,
            start_ms: (_b = to_ms(data.periodStartDate)) !== null && _b !== void 0 ? _b : 0,
            end_ms: (_c = to_ms(data.periodEndDate)) !== null && _c !== void 0 ? _c : 0,
            due_date_ms: to_ms(data.firstDueDateInPeriod),
            amount_per_occurrence: per_occurrence,
            occurrence_due_dates_ms: due_dates_ms,
            is_variable_amount,
            period_type: String((_d = data.periodType) !== null && _d !== void 0 ? _d : ""),
        };
    });
    // 3. Linked payments from the doc's `transactionIds` MEMBERSHIP. Those are Plaid
    //    transaction ids (NOT Firestore doc ids), so load by `transactionId`. The
    //    membership IS the link — a listed transaction is a payment for this recurring
    //    item, regardless of whether the engine has stamped `split.outflow_id` yet.
    //    Each transaction contributes its net countable amount (one payment).
    const splits = [];
    const user_id = (_e = recurring.user_id) !== null && _e !== void 0 ? _e : "";
    const txns = await transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, transaction_ids);
    for (const txn of txns) {
        if (txn.isActive === false)
            continue;
        const date_ms = (_f = to_ms(txn.transactionDate)) !== null && _f !== void 0 ? _f : 0;
        const is_pending = txn.isPending === true;
        let amount = 0;
        let split_id = txn.id;
        for (const s of (_g = txn.splits) !== null && _g !== void 0 ? _g : []) {
            if (s.isIgnored)
                continue;
            const magnitude = Math.abs(Number((_h = s.amount) !== null && _h !== void 0 ? _h : 0));
            amount += s.isRefund ? -magnitude : magnitude;
            if (s.splitId)
                split_id = s.splitId;
        }
        splits.push({ transaction_id: txn.id, split_id, amount, is_pending, date_ms });
    }
    console.log(`[${ctx.trace_id}] resolve_recurring_reconciliation: ${input.recurring_type}=${input.recurring_id}, ` +
        `active_periods=${periods.length}, linked_splits=${splits.length}`);
    return { periods, splits };
}
//# sourceMappingURL=period_reconciliation.resolver.js.map