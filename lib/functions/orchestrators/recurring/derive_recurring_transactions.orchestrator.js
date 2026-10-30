"use strict";
/**
 * Derive Recurring Transactions (orchestrator)
 *
 * READ-ONLY: every transaction that pays a recurring inflow/outflow, for its detail screen.
 * Candidates = the stream's own `transaction_ids` (Plaid membership, matched to our docs by the
 * `transactionId` field) UNION the transactions whose splits are linked to it
 * (`splitOutflowIds` / `splitInflowIds`: hand-assigned bill pins + engine matches — a manual bill
 * has no Plaid stream at all). Each candidate then goes through THE per-split rule the period
 * page and reconcile use (`splits_paying_recurring`), so the list and the paid status agree.
 * Each row is flagged `in_period` for the currently-viewed window so the screen
 * can render a "This Period" section and a "Historical" (all-time) section.
 *
 * Row ids are Firestore DOC ids (Transaction Detail loads `transactions/{docId}`); each row
 * carries the card payload so the app renders the real transaction row (Tappable-Transaction-Rows).
 *
 * @module orchestrators/recurring/derive_recurring_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_recurring_transactions_orchestrator = derive_recurring_transactions_orchestrator;
const late_payment_service_1 = require("../../domain/recurring/late_payment.service");
const period_reconciliation_service_1 = require("../../domain/recurring/period_reconciliation.service");
const repositories_1 = require("../../repositories");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const stream_membership_1 = require("../../domain/recurring/stream_membership");
const transaction_card_service_1 = require("../../domain/transactions/transaction_card.service");
async function derive_recurring_transactions_orchestrator(ctx, user_id, recurring_id, kind, window_start_ms, window_end_ms) {
    var _a, _b;
    // 1. Load the recurring record → its Plaid stream ids.
    const record = kind === "inflow"
        ? await repositories_1.inflow_repo.get_by_id(ctx, recurring_id)
        : await repositories_1.outflow_repo.get_by_id(ctx, recurring_id);
    if (!record || record.user_id !== user_id)
        return [];
    const plaid_ids = (_a = record.transaction_ids) !== null && _a !== void 0 ? _a : [];
    const release_schedule = kind === "outflow" && ((_b = record.removal_intervals) === null || _b === void 0 ? void 0 : _b.length)
        ? (0, late_payment_service_1.bill_release_schedule)(record)
        : null;
    // 2. Candidates: the Plaid stream's transactions + the ones linked by split (one
    //    `array-contains` query on the durable denorm), deduped by doc id.
    const [stream_txns, linked_txns] = await Promise.all([
        transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, plaid_ids),
        transaction_repo_1.transaction_repo.get_by_split_recurring_link(ctx, user_id, kind, recurring_id),
    ]);
    const by_doc_id = new Map();
    for (const t of [...stream_txns, ...linked_txns]) {
        const doc_id = t.id;
        if (doc_id && !by_doc_id.has(doc_id))
            by_doc_id.set(doc_id, t);
    }
    const stream_ids = new Set(plaid_ids);
    const txns = Array.from(by_doc_id.values());
    // 3. Map + flag in-period.
    const paying_rows = txns
        .filter((data) => data.isActive !== false)
        // Per SPLIT (the period page's rule): the splits paying this recurring — a "remove from bill"
        // or a budget pin takes only THAT split off; no paying split → not one of its payments. A
        // transaction outside the Plaid stream pays only through splits explicitly linked to it.
        .map((data) => {
        var _a, _b;
        return ({
            data,
            // Edge money (a transfer crossing the view) pays nothing — as the period page.
            splits: (0, stream_membership_1.is_edge_money)(data.transferRole)
                ? []
                : (0, stream_membership_1.splits_paying_recurring)(((_a = data.splits) !== null && _a !== void 0 ? _a : []), kind, recurring_id, stream_ids.has((_b = data.transactionId) !== null && _b !== void 0 ? _b : "")),
        });
    })
        // Its NET countable amount, as the period page and reconcile count it (Ignored adds nothing,
        // Refund subtracts); a payment that nets to nothing isn't listed.
        .map((row) => (Object.assign(Object.assign({}, row), { net: (0, period_reconciliation_service_1.compute_countable_split_net)(row.splits, "").amount })))
        .filter(({ splits, net }) => splits.length > 0 && net > 0);
    const date_of = (data) => { var _a, _b, _c; return (_c = (_b = (_a = data.transactionDate) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0; };
    const id_of = (data) => { var _a; return (_a = data.id) !== null && _a !== void 0 ? _a : ""; };
    // D31 / D37: the bill's payments, as the release rule judges a late payment by them.
    const release_bill = release_schedule
        ? { schedule: release_schedule, payments: paying_rows.map((r) => ({ id: id_of(r.data), date_ms: date_of(r.data), amount: r.net })) }
        : null;
    const rows = paying_rows
        // A payment in a month this bill / income is removed / paused for pays nothing (X9 — as the
        // period page, the engine and reconcile). D31 / D37: except a bill's LATE payment of its last
        // occurrence before the cut-off while that occurrence is still unpaid.
        .filter(({ data }) => !(0, late_payment_service_1.is_payment_released)(record.removal_intervals, { id: id_of(data), date_ms: date_of(data) }, release_bill))
        .map(({ data, splits, net }) => {
        const d = data;
        const doc_id = d.id;
        const date_ms = d.transactionDate.toMillis();
        return {
            transaction_id: doc_id,
            split_ids: splits
                .map((s) => { var _a, _b; return ((_b = (_a = s.splitId) !== null && _a !== void 0 ? _a : s.id) !== null && _b !== void 0 ? _b : ""); })
                .filter(Boolean),
            date_ms,
            name: d.merchantName ||
                d.name ||
                d.description ||
                "Transaction",
            amount: net,
            is_pending: d.isPending === true,
            in_period: date_ms >= window_start_ms && date_ms <= window_end_ms,
            card: (0, transaction_card_service_1.to_card_transaction)(doc_id, d),
        };
    });
    rows.sort((a, b) => b.date_ms - a.date_ms); // newest first
    return rows;
}
//# sourceMappingURL=derive_recurring_transactions.orchestrator.js.map