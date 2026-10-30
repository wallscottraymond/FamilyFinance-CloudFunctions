"use strict";
/**
 * Inflow Pin Resolver — READ-ONLY facts for pinning a split to an income (Convert-To-Recurring
 * Phase 2). Loads the transaction, the income and the caller's account placements; decides nothing
 * (the domain `plan_inflow_pin` does). Authorization is by OWNER, never by group: a member probing
 * the owner's ids learns nothing (the domain answers a missing and a foreign income the same way).
 *
 * @module resolvers/recurring/inflow_pin
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_inflow_pin_facts = resolve_inflow_pin_facts;
const transaction_repo_1 = require("../../repositories/transaction.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const account_repo_1 = require("../../repositories/account.repo");
/** The view an account's payment dated `date_ms` counts in: its group (from the share date), else Me. */
function view_of(accounts, account_key, date_ms) {
    const a = accounts.find((x) => x.id === account_key || x.account_id === account_key);
    const p = a === null || a === void 0 ? void 0 : a.placement;
    if (!p)
        return null;
    return p.shared_from_ms === null || date_ms >= p.shared_from_ms ? p.group_id : null;
}
async function resolve_inflow_pin_facts(ctx, user_id, transaction_id, inflow_id) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const txn = await transaction_repo_1.transaction_repo.get_raw_by_id(ctx, transaction_id);
    if (!txn)
        return null;
    const d = txn.data;
    // Nothing else is read for someone else's transaction (no leak, no cost).
    const owner = (_b = ((_a = d.ownerId) !== null && _a !== void 0 ? _a : d.userId)) !== null && _b !== void 0 ? _b : null;
    const base = {
        owner_id: owner,
        type: (_c = d.type) !== null && _c !== void 0 ? _c : null,
        transfer_role: (_d = d.transferRole) !== null && _d !== void 0 ? _d : null,
        split_ids: ((_e = d.splits) !== null && _e !== void 0 ? _e : []).map((s) => { var _a; return (_a = s.splitId) !== null && _a !== void 0 ? _a : ""; }),
    };
    if (owner !== user_id) {
        return { txn: base, inflow: null, txn_view: null, inflow_view: null };
    }
    const [inflow, accounts] = await Promise.all([
        inflow_id ? inflow_repo_1.inflow_repo.get_by_id(ctx, inflow_id) : Promise.resolve(null),
        inflow_id ? account_repo_1.account_repo.get_by_user_id(ctx, user_id) : Promise.resolve([]),
    ]);
    const date_ms = (_h = (_g = (_f = d.transactionDate) === null || _f === void 0 ? void 0 : _f.toMillis) === null || _g === void 0 ? void 0 : _g.call(_f)) !== null && _h !== void 0 ? _h : 0;
    return {
        txn: base,
        inflow: inflow ? { owner_id: inflow.user_id, is_active: inflow.is_active, is_hidden: inflow.is_hidden } : null,
        txn_view: view_of(accounts, (_j = d.accountId) !== null && _j !== void 0 ? _j : "", date_ms),
        // The income's account placement applies from its share date, judged at the payment's date
        // (the engine's `of_view` rule).
        inflow_view: inflow ? view_of(accounts, (_k = inflow.account_id) !== null && _k !== void 0 ? _k : "", date_ms) : null,
    };
}
//# sourceMappingURL=inflow_pin.resolver.js.map