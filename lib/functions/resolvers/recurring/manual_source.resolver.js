"use strict";
/**
 * Manual Add Bill / Add Income source resolver (Convert-To-Recurring D43) — READ-ONLY.
 *
 * A hand-added record gets a D1 key ONLY when it comes from a REAL transaction of the caller (its
 * Plaid account + its vendor key); a typed name never makes a key (it would strip the record from
 * fuzzy matching without matching anything). An account the caller picks must be the caller's own
 * (a forged `accountId` is refused). Nothing is read when neither is given.
 *
 * @module resolvers/recurring/manual_source
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_manual_source = resolve_manual_source;
const account_repo_1 = require("../../repositories/account.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const convert_resolver_1 = require("./convert.resolver");
async function resolve_manual_source(ctx, user_id, input) {
    var _a, _b;
    let account_id = (_a = input.account_id) !== null && _a !== void 0 ? _a : "";
    let vendor_key = null;
    let vendor_source = null;
    let txn_doc_id = null;
    if (input.source_transaction_id) {
        const txn = await transaction_repo_1.transaction_repo.get_raw_by_id(ctx, input.source_transaction_id);
        const owner = (_b = txn === null || txn === void 0 ? void 0 : txn.data.ownerId) !== null && _b !== void 0 ? _b : txn === null || txn === void 0 ? void 0 : txn.data.userId;
        if (!txn || owner !== user_id)
            return { ok: false, reason: "transaction_not_yours" };
        const f = (0, convert_resolver_1.txn_facts)(txn.id, txn.data, false);
        if (account_id && account_id !== f.account_id)
            return { ok: false, reason: "account_mismatch" };
        account_id = f.account_id;
        vendor_key = f.vendor_key;
        vendor_source = f.vendor_source;
        txn_doc_id = txn.id;
    }
    if (account_id) {
        const accounts = await account_repo_1.account_repo.get_by_user_id(ctx, user_id);
        const mine = accounts.find((a) => a.account_id === account_id || a.id === account_id);
        if (!mine)
            return { ok: false, reason: "account_not_yours" };
        account_id = mine.account_id || mine.id; // always the Plaid account id the payments carry
    }
    return { ok: true, account_id, vendor_key, vendor_source, txn_doc_id };
}
//# sourceMappingURL=manual_source.resolver.js.map