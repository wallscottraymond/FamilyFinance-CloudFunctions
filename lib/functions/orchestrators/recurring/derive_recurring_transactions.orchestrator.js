"use strict";
/**
 * Derive Recurring Transactions (orchestrator)
 *
 * READ-ONLY: every transaction that belongs to a recurring inflow/outflow stream,
 * for its detail screen. Source of truth is the stream's own `transaction_ids`
 * (Plaid links them; matched to our transactions by the `transactionId` field).
 * Each row is flagged `in_period` for the currently-viewed window so the screen
 * can render a "This Period" section and a "Historical" (all-time) section.
 *
 * @module orchestrators/recurring/derive_recurring_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_recurring_transactions_orchestrator = derive_recurring_transactions_orchestrator;
const repositories_1 = require("../../repositories");
const transaction_repo_1 = require("../../repositories/transaction.repo");
async function derive_recurring_transactions_orchestrator(ctx, user_id, recurring_id, kind, window_start_ms, window_end_ms) {
    var _a;
    // 1. Load the recurring record → its Plaid transaction ids.
    const record = kind === "inflow"
        ? await repositories_1.inflow_repo.get_by_id(ctx, recurring_id)
        : await repositories_1.outflow_repo.get_by_id(ctx, recurring_id);
    if (!record || record.user_id !== user_id)
        return [];
    const plaid_ids = (_a = record.transaction_ids) !== null && _a !== void 0 ? _a : [];
    // 2. Fetch those transactions (by the `transactionId` field).
    const txns = await transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, plaid_ids);
    // 3. Map + flag in-period.
    const rows = txns
        .filter((data) => data.isActive !== false)
        .map((data) => {
        var _a, _b, _c;
        const d = data;
        const date_ms = d.transactionDate.toMillis();
        const splits = (_a = d.splits) !== null && _a !== void 0 ? _a : [];
        return {
            transaction_id: (_c = (_b = d.transactionId) !== null && _b !== void 0 ? _b : d.id) !== null && _c !== void 0 ? _c : "",
            date_ms,
            name: d.merchantName ||
                d.name ||
                d.description ||
                "Transaction",
            amount: splits.reduce((s, sp) => { var _a; return s + Math.abs((_a = sp.amount) !== null && _a !== void 0 ? _a : 0); }, 0),
            is_pending: d.isPending === true,
            in_period: date_ms >= window_start_ms && date_ms <= window_end_ms,
        };
    });
    rows.sort((a, b) => b.date_ms - a.date_ms); // newest first
    return rows;
}
//# sourceMappingURL=derive_recurring_transactions.orchestrator.js.map