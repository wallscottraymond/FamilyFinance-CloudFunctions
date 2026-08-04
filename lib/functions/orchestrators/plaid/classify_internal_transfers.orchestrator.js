"use strict";
/**
 * Classify Internal Transfers (orchestrator step)
 *
 * Plaid recurring detection recreates internal account-transfer streams on every
 * sync (they're subscribed) and adds more when new cards are linked. We can't tell
 * an internal transfer from an external ACH bill at transform time — it needs
 * matched-pair detection across accounts. So AFTER each recurring sync we classify
 * the user's recurring outflow/inflow records and durably HIDE the internal ones
 * (kept: external ACH bills + credit-card payments). `isHidden` is preserved by
 * `save_batch`, so the hide survives future re-syncs of the same stream.
 *
 * Self-correcting: also UN-hides transfer records that are no longer internal.
 *
 * @module orchestrators/plaid/classify_internal_transfers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classify_internal_transfers_orchestrator = classify_internal_transfers_orchestrator;
const repositories_1 = require("../../repositories");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const category_semantics_service_1 = require("../../domain/transactions/category_semantics.service");
const internal_transfer_service_1 = require("../../domain/transactions/internal_transfer.service");
/** Credit-card payments are always KEPT (a real recurring bill), never hidden. */
const CC_PAYMENT_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** Window of transactions loaded for matched-pair detection. */
const PAIRING_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
/**
 * A recurring record should be HIDDEN when it is a transfer category, is an
 * internal (matched-pair) transfer, and is NOT a credit-card payment.
 */
function should_hide(plaid_detailed_category, transaction_ids, internal_plaid_ids) {
    if (plaid_detailed_category === CC_PAYMENT_CATEGORY)
        return false;
    if (!(0, category_semantics_service_1.is_transfer_category)(plaid_detailed_category))
        return false;
    return (transaction_ids !== null && transaction_ids !== void 0 ? transaction_ids : []).some((t) => internal_plaid_ids.has(t));
}
async function classify_internal_transfers_orchestrator(ctx, user_id, now_ms) {
    var _a, _b, _c, _d, _e, _f;
    // 1. Load recurring records + a recent window of transactions (for pairing).
    const [outflows, inflows, txns] = await Promise.all([
        repositories_1.outflow_repo.get_by_user_id(ctx, user_id),
        repositories_1.inflow_repo.get_by_user_id(ctx, user_id),
        transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, now_ms - PAIRING_WINDOW_MS, now_ms),
    ]);
    // 2. Matched-pair internal-transfer detection over the window's transfers.
    const transfers = [];
    for (const { id, data } of txns) {
        const raw = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
        const first = (_b = raw[0]) !== null && _b !== void 0 ? _b : {};
        const eff = (_d = (_c = first.internalDetailedCategory) !== null && _c !== void 0 ? _c : first.plaidDetailedCategory) !== null && _d !== void 0 ? _d : "";
        if (!(0, category_semantics_service_1.is_transfer_category)(eff))
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
    const { internal_plaid_ids } = (0, internal_transfer_service_1.detect_internal_transfers)(transfers);
    // 3. Split each collection into hide / unhide (self-correcting).
    const partition = (records) => {
        const hide = [];
        const unhide = [];
        for (const r of records) {
            const target = should_hide(r.plaid_detailed_category, r.transaction_ids, internal_plaid_ids);
            if (target && !r.is_hidden)
                hide.push(r.id);
            else if (!target && r.is_hidden)
                unhide.push(r.id);
        }
        return { hide, unhide };
    };
    const out = partition(outflows);
    const inf = partition(inflows);
    await Promise.all([
        repositories_1.outflow_repo.mark_hidden(ctx, out.hide, true, user_id),
        repositories_1.outflow_repo.mark_hidden(ctx, out.unhide, false, user_id),
        repositories_1.inflow_repo.mark_hidden(ctx, inf.hide, true, user_id),
        repositories_1.inflow_repo.mark_hidden(ctx, inf.unhide, false, user_id),
    ]);
    return { hidden_outflows: out.hide.length, hidden_inflows: inf.hide.length };
}
//# sourceMappingURL=classify_internal_transfers.orchestrator.js.map