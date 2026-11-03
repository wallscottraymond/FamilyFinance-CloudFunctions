"use strict";
/**
 * Link posted deposits to the income line whose description they exactly match (AF-08), for the
 * ones Plaid hasn't listed on the stream. Writes the ids to the line, re-assigns those deposits so
 * their splits carry the link, and returns the follow-ups (reconcile, derive version).
 *
 * The ids are kept in their own field and survive Plaid's stream refresh (`inflow.repo`), so every
 * reader keeps using the one `transactionIds`.
 *
 * Reads the user's income lines only when a candidate deposit exists (usually none).
 *
 * @module orchestrators/plaid/link_income_by_payer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.link_income_by_payer_orchestrator = link_income_by_payer_orchestrator;
const inflow_repo_1 = require("../../repositories/inflow.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const assign_transactions_batch_orchestrator_1 = require("../transactions/assign_transactions_batch.orchestrator");
const category_catalog_resolver_1 = require("../../resolvers/shared/category_catalog.resolver");
const split_category_service_1 = require("../../domain/transactions/split_category.service");
const split_category_edit_service_1 = require("../../domain/transactions/split_category_edit.service");
const stream_membership_1 = require("../../domain/recurring/stream_membership");
const income_payer_match_service_1 = require("../../domain/recurring/income_payer_match.service");
const sync_follow_ups_1 = require("./sync_follow_ups");
/** A transaction doc as a candidate deposit, or null when it can't be one. */
function to_candidate(data, catalog) {
    var _a, _b, _c;
    const plaid_id = data.transactionId;
    if (!plaid_id || data.type !== "income" || data.isActive === false || data.isPending === true)
        return null;
    const splits = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
    if (splits.length === 0)
        return null;
    const is_other_income = splits.every((s) => (0, stream_membership_1.is_other_income_split)(s, (0, split_category_service_1.resolve_split_category)((0, split_category_edit_service_1.split_category_input_from_raw)(s, data, catalog), catalog).semantic_code, false, true));
    if (!is_other_income)
        return null;
    return {
        plaid_id,
        name: (_b = data.name) !== null && _b !== void 0 ? _b : null,
        account_id: (_c = data.accountId) !== null && _c !== void 0 ? _c : null,
        date_ms: data.transactionDate.toMillis(),
        is_pending: false,
        is_other_income: true,
    };
}
async function link_income_by_payer_orchestrator(ctx, user_id, run_id, docs) {
    const none = { follow_ups: (0, sync_follow_ups_1.empty_follow_ups)(), linked: new Map() };
    if (!docs.some((d) => d.type === "income"))
        return none;
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    const deposits = docs
        .map((d) => to_candidate(d, catalog))
        .filter((d) => d !== null);
    if (deposits.length === 0)
        return none;
    const lines = await inflow_repo_1.inflow_repo.get_by_user_id(ctx, user_id);
    const linked = (0, income_payer_match_service_1.match_deposits_to_income_lines)(deposits, lines.map((l) => {
        var _a, _b;
        return ({
            id: l.id,
            description: l.description,
            account_id: l.account_id,
            first_date_ms: l.first_date ? l.first_date.toMillis() : null,
            is_active: l.is_active,
            is_hidden: l.is_hidden,
            transaction_ids: (_a = l.transaction_ids) !== null && _a !== void 0 ? _a : [],
            removal_intervals: (_b = l.removal_intervals) !== null && _b !== void 0 ? _b : [],
        });
    }));
    // Linked on the line by an earlier run that stopped before re-assigning: finish them, since the
    // matcher now sees them as already on a stream. Candidates only: a split carrying its link isn't.
    const unfinished = new Map();
    for (const l of lines) {
        const ids = deposits
            .filter((d) => { var _a; return ((_a = l.payer_matched_transaction_ids) !== null && _a !== void 0 ? _a : []).includes(d.plaid_id); })
            .map((d) => d.plaid_id);
        if (ids.length)
            unfinished.set(l.id, ids);
    }
    if (linked.size === 0 && unfinished.size === 0)
        return none;
    if (linked.size > 0)
        await inflow_repo_1.inflow_repo.add_payer_matched_transactions(ctx, linked, run_id);
    const all_ids = [...linked.values(), ...unfinished.values()].flat();
    const stored = await transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, all_ids);
    const written = [];
    await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
        user_id,
        transaction_ids: stored.map((d) => d.id),
        run_id,
        collect_into: written,
    });
    return {
        linked,
        follow_ups: (0, sync_follow_ups_1.merge_follow_ups)((0, sync_follow_ups_1.follow_ups_from_written)(written), {
            inflow_ids: [...new Set([...linked.keys(), ...unfinished.keys()])],
            recurring_changed: true,
        }),
    };
}
//# sourceMappingURL=link_income_by_payer.orchestrator.js.map