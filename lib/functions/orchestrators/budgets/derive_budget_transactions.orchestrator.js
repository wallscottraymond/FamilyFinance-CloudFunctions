"use strict";
/**
 * Derive Budget Transactions (orchestrator)
 *
 * READ-ONLY (Derive-On-Read): the transactions a budget owns FOR A PERIOD,
 * resolved ON READ (category + manual pin + Everything-Else fallback) — not from a
 * stored `budgetId`. Each owned split is tagged with a DERIVED display status:
 *   - counted  → contributes to Spent
 *   - ignored  → excluded from Spent but VISIBLE + user-manageable. Reasons:
 *       transfer (internal account transfer, matched-pair), income (real INCOME_*),
 *       manual (user set spendStatus='ignored')
 *   - refund   → money back (spendStatus='refund')
 * Recurring-linked splits (outflow/inflow) are omitted — they're tracked as bills/income.
 *
 * This lets the budget-detail screen show ignored items (incl. auto-ignored
 * transfers) in a dedicated section, with the pill to include them if desired.
 *
 * @module orchestrators/budgets/derive_budget_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_budget_transactions_orchestrator = derive_budget_transactions_orchestrator;
const budget_repo_1 = require("../../repositories/budget.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const budget_spend_match_service_1 = require("../../domain/budgets/budget_spend_match.service");
const on_read_matching_1 = require("../../resolvers/shared/on_read_matching");
// widen the window so cross-day transfer pairs match
const PAIRING_BUFFER_MS = 7 * 24 * 60 * 60 * 1000;
function to_cadence(period) {
    return period === "weekly" ? "weekly" : period === "bi_monthly" ? "bi_monthly" : "monthly";
}
async function derive_budget_transactions_orchestrator(ctx, user_id, budget_id, start_ms, end_ms) {
    var _a, _b, _c, _d, _e, _f, _g;
    // 1. Budgets → real budgets (category ownership) + the EE id + is-target-EE.
    const budgets = await budget_repo_1.budget_repo.get_by_user_id(ctx, user_id);
    const real_budgets = [];
    let monthly_ee_id = null;
    let any_ee_id = null;
    let target_is_ee = false;
    for (const b of budgets) {
        if (b.is_system_everything_else) {
            any_ee_id = any_ee_id !== null && any_ee_id !== void 0 ? any_ee_id : b.id;
            if (b.period === "monthly")
                monthly_ee_id = b.id;
            if (b.id === budget_id)
                target_is_ee = true;
        }
        else {
            real_budgets.push({
                id: b.id,
                category_ids: b.category_ids,
                start_ms: b.start_date.toMillis(),
                end_ms: b.is_ongoing ? null : b.end_date.toMillis(),
                is_ongoing: b.is_ongoing,
                cadence: to_cadence(b.period),
            });
        }
    }
    const ee_id = target_is_ee ? budget_id : monthly_ee_id !== null && monthly_ee_id !== void 0 ? monthly_ee_id : any_ee_id;
    // 2. Load the window's transactions (+ a small buffer for transfer pairing).
    const txns = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, start_ms - PAIRING_BUFFER_MS, end_ms + PAIRING_BUFFER_MS);
    // 3. Matched-pair internal-transfer detection over the buffered window.
    const { internal_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(txns);
    // 4. Resolve ownership on read; keep only splits owned by the target budget, in-window.
    const out = [];
    for (const { id, data } of txns) {
        const date_ms = data.transactionDate.toMillis();
        if (date_ms < start_ms || date_ms > end_ms)
            continue;
        const is_pending = data.isPending === true;
        const txn_is_internal_transfer = internal_ids.has(id);
        const raw = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
        const name = data.merchantName ||
            data.name ||
            data.description ||
            "Transaction";
        for (const s of raw) {
            const outflow_id = (_b = s.outflowId) !== null && _b !== void 0 ? _b : null;
            const inflow_id = (_c = s.inflowId) !== null && _c !== void 0 ? _c : null;
            // Recurring-linked splits are tracked as bills/income, not budget lines.
            if (outflow_id || inflow_id)
                continue;
            const match = (0, on_read_matching_1.map_raw_split_to_on_read_match)(s, {
                txn_date_ms: date_ms,
                is_pending,
                is_transfer: txn_is_internal_transfer,
                is_income: data.type === "income",
            });
            if ((0, budget_spend_match_service_1.resolve_split_owner)(match, real_budgets, ee_id) !== budget_id)
                continue;
            // Derive the display status (transfers/income → ignored; else the stored status).
            let spend_status = match.spend_status;
            let ignored_reason = null;
            if (txn_is_internal_transfer) {
                spend_status = "ignored";
                ignored_reason = "transfer";
            }
            else if ((0, budget_spend_service_1.is_income_category)((_d = match.internal_match_category) !== null && _d !== void 0 ? _d : match.plaid_match_category)) {
                spend_status = "ignored";
                ignored_reason = "income";
            }
            else if (match.spend_status === "ignored") {
                ignored_reason = "manual";
            }
            out.push({
                transaction_id: id,
                split_id: (_f = (_e = s.splitId) !== null && _e !== void 0 ? _e : s.id) !== null && _f !== void 0 ? _f : null,
                date_ms,
                name,
                amount: Math.abs((_g = s.amount) !== null && _g !== void 0 ? _g : 0),
                is_pending,
                spend_status,
                ignored_reason,
            });
        }
    }
    // Newest first.
    out.sort((a, b) => b.date_ms - a.date_ms);
    return out;
}
//# sourceMappingURL=derive_budget_transactions.orchestrator.js.map