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
const internal_transfer_service_1 = require("../../domain/transactions/internal_transfer.service");
const PAIRING_BUFFER_MS = 7 * 24 * 60 * 60 * 1000; // widen the window so cross-day transfer pairs match
function to_cadence(period) {
    return period === "weekly" ? "weekly" : period === "bi_monthly" ? "bi_monthly" : "monthly";
}
async function derive_budget_transactions_orchestrator(ctx, user_id, budget_id, start_ms, end_ms) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
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
    const transfers = [];
    for (const { id, data } of txns) {
        const raw = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
        const first = (_b = raw[0]) !== null && _b !== void 0 ? _b : {};
        const eff = (_d = (_c = first.internalDetailedCategory) !== null && _c !== void 0 ? _c : first.plaidDetailedCategory) !== null && _d !== void 0 ? _d : "";
        if (!(0, budget_spend_service_1.is_transfer_category)(eff))
            continue;
        transfers.push({
            id,
            plaid_id: (_e = data.transactionId) !== null && _e !== void 0 ? _e : null,
            account_id: (_f = data.accountId) !== null && _f !== void 0 ? _f : "",
            amount: raw.reduce((s, sp) => { var _a; return s + Math.abs((_a = sp.amount) !== null && _a !== void 0 ? _a : 0); }, 0),
            date_ms: data.transactionDate.toMillis(),
            direction: eff.startsWith("TRANSFER_IN") ? "in" : "out",
        });
    }
    const { internal_ids } = (0, internal_transfer_service_1.detect_internal_transfers)(transfers);
    // 4. Resolve ownership on read; keep only splits owned by the target budget, in-window.
    const out = [];
    for (const { id, data } of txns) {
        const date_ms = data.transactionDate.toMillis();
        if (date_ms < start_ms || date_ms > end_ms)
            continue;
        const is_pending = data.isPending === true;
        const txn_is_internal_transfer = internal_ids.has(id);
        const raw = (_g = data.splits) !== null && _g !== void 0 ? _g : [];
        const name = data.merchantName ||
            data.name ||
            data.description ||
            "Transaction";
        for (const s of raw) {
            const outflow_id = (_h = s.outflowId) !== null && _h !== void 0 ? _h : null;
            const inflow_id = (_j = s.inflowId) !== null && _j !== void 0 ? _j : null;
            // Recurring-linked splits are tracked as bills/income, not budget lines.
            if (outflow_id || inflow_id)
                continue;
            const internal_category = (_k = s.internalDetailedCategory) !== null && _k !== void 0 ? _k : null;
            const plaid_category = (_l = s.plaidDetailedCategory) !== null && _l !== void 0 ? _l : "OTHER_EXPENSE";
            const match = {
                amount: (_m = s.amount) !== null && _m !== void 0 ? _m : 0,
                txn_date_ms: date_ms,
                is_pending,
                is_transfer: txn_is_internal_transfer,
                is_income: data.type === "income",
                spend_status: (_o = s.spendStatus) !== null && _o !== void 0 ? _o : (s.isIgnored === true ? "ignored" : s.isRefund === true ? "refund" : "counted"),
                outflow_id,
                inflow_id,
                internal_match_category: internal_category,
                plaid_match_category: plaid_category,
                overall_category_id: (_p = s.overallCategoryId) !== null && _p !== void 0 ? _p : null,
                first_category_id: (_q = s.firstCategoryId) !== null && _q !== void 0 ? _q : null,
                manual_pin_budget_id: s.budgetAssignmentSource === "manual" ? (_r = s.budgetId) !== null && _r !== void 0 ? _r : null : null,
            };
            if ((0, budget_spend_match_service_1.resolve_split_owner)(match, real_budgets, ee_id) !== budget_id)
                continue;
            // Derive the display status (transfers/income → ignored; else the stored status).
            let spend_status = match.spend_status;
            let ignored_reason = null;
            if (txn_is_internal_transfer) {
                spend_status = "ignored";
                ignored_reason = "transfer";
            }
            else if ((0, budget_spend_service_1.is_income_category)(internal_category !== null && internal_category !== void 0 ? internal_category : plaid_category)) {
                spend_status = "ignored";
                ignored_reason = "income";
            }
            else if (match.spend_status === "ignored") {
                ignored_reason = "manual";
            }
            out.push({
                transaction_id: id,
                split_id: (_t = (_s = s.splitId) !== null && _s !== void 0 ? _s : s.id) !== null && _t !== void 0 ? _t : null,
                date_ms,
                name,
                amount: Math.abs((_u = s.amount) !== null && _u !== void 0 ? _u : 0),
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