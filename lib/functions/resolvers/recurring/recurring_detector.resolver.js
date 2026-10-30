"use strict";
/**
 * Recurring Detector Resolver — READ-ONLY lookups for the possible-bill detector.
 *
 * The classifier's scan already holds the window's transactions and the ACTIVE records. The
 * detector also must skip payments in INACTIVE streams (X14), so their stream ids are read here
 * (two small owner-scoped queries, once a day at most). Review items are looked up by their
 * deterministic ids (getAll, X8); account types only when an income candidate needs the gate.
 *
 * @module resolvers/recurring/recurring_detector
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_detector_context = resolve_detector_context;
const repositories_1 = require("../../repositories");
const account_repo_1 = require("../../repositories/account.repo");
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const vendor_key_service_1 = require("../../domain/transactions/vendor_key.service");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
async function resolve_detector_context(ctx, user_id, scan) {
    var _a, _b;
    const [inactive_o, inactive_i] = await Promise.all([
        repositories_1.outflow_repo.get_inactive_by_user_id(ctx, user_id),
        repositories_1.inflow_repo.get_inactive_by_user_id(ctx, user_id),
    ]);
    const record_txn_ids = new Set();
    const record_vendor_subjects = new Set();
    const add = (kind, ids, merchant, description, active) => {
        for (const t of ids)
            record_txn_ids.add(t);
        if (!active)
            return;
        const v = (0, vendor_key_service_1.vendor_key)({ merchant_name: merchant, name: description });
        if (v)
            record_vendor_subjects.add((0, review_item_service_1.suggested_subject)(kind, v));
    };
    for (const r of scan.records)
        add(r.kind, r.transaction_ids, r.merchant_name, r.description, true);
    for (const r of inactive_o)
        add("outflow", (_a = r.transaction_ids) !== null && _a !== void 0 ? _a : [], r.merchant_name, r.description, false);
    for (const r of inactive_i)
        add("inflow", (_b = r.transaction_ids) !== null && _b !== void 0 ? _b : [], r.payer_name, r.description, false);
    return {
        record_txn_ids,
        record_vendor_subjects,
        load_items: (ids) => recurring_review_repo_1.recurring_review_repo.get_items_by_ids(ctx, ids),
        load_account_types: async () => {
            var _a;
            const accounts = await account_repo_1.account_repo.get_by_user_id(ctx, user_id);
            const m = new Map();
            for (const a of accounts) {
                const type = String((_a = a.account_type) !== null && _a !== void 0 ? _a : "");
                if (a.account_id)
                    m.set(a.account_id, type);
                m.set(a.id, type);
            }
            return m;
        },
    };
}
//# sourceMappingURL=recurring_detector.resolver.js.map