"use strict";
/**
 * On-Read Spend Resolver
 *
 * READ-ONLY gathering for the "instant budgets" path (Derive-On-Read): produce
 * the splits a budget owns by matching them ON READ (category + manual pin),
 * NOT by reading a pre-computed stored `budgetId`. This is what lets a brand-new
 * budget show its transactions immediately — no write-time assignment cascade.
 *
 * Loads the user's budgets (to know category ownership + the Everything-Else
 * fallback) + the splits in the window, maps them to the matcher's shape, and
 * returns the target budget's owned splits as `SplitForSpend[]` — which flow
 * straight into the existing `budget_view` derivation (bucketing + pro-ration).
 *
 * Reuses the pure `owned_splits_for_budget` (which reuses `match_budget`), so it
 * makes the identical decisions the write-time engine would. No writes.
 *
 * @module resolvers/budgets/on_read_spend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_on_read_spend_splits = resolve_on_read_spend_splits;
const budget_repo_1 = require("../../repositories/budget.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_spend_match_service_1 = require("../../domain/budgets/budget_spend_match.service");
const on_read_matching_1 = require("../shared/on_read_matching");
function to_cadence(period) {
    return period === "weekly" ? "weekly" : period === "bi_monthly" ? "bi_monthly" : "monthly";
}
/**
 * The splits owned by `target_budget_id` over the window, resolved on read.
 *
 * @param target_is_ee - Whether the target budget is the Everything-Else budget.
 *                       When true, the matcher's EE fallback id is the target
 *                       itself (so unmatched splits land here); otherwise a real
 *                       budget only receives its category matches.
 */
async function resolve_on_read_spend_splits(ctx, user_id, target_budget_id, target_is_ee, start_ms, end_ms) {
    var _a;
    // 1. Load the user's budgets → real budgets (for category ownership) + the EE id.
    const budgets = await budget_repo_1.budget_repo.get_by_user_id(ctx, user_id);
    const real_budgets = [];
    let monthly_ee_id = null;
    let any_ee_id = null;
    for (const b of budgets) {
        if (b.is_system_everything_else) {
            any_ee_id = any_ee_id !== null && any_ee_id !== void 0 ? any_ee_id : b.id;
            if (b.period === "monthly") {
                monthly_ee_id = b.id;
            }
            continue;
        }
        real_budgets.push({
            id: b.id,
            category_ids: b.category_ids,
            start_ms: b.start_date.toMillis(),
            end_ms: b.is_ongoing ? null : b.end_date.toMillis(),
            is_ongoing: b.is_ongoing,
            cadence: to_cadence(b.period),
        });
    }
    // For a real target the EE id is irrelevant (it only receives category matches);
    // for the EE target the fallback must route unmatched splits to the target.
    const ee_id = target_is_ee ? target_budget_id : monthly_ee_id !== null && monthly_ee_id !== void 0 ? monthly_ee_id : any_ee_id;
    // 2. Load the window's transactions and map splits to the matcher's shape.
    const txns = await transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, start_ms, end_ms);
    // Only INTERNAL (matched-pair own-account) transfers are excluded from spend —
    // external ACH bills Plaid tags TRANSFER stay countable. Same rule everywhere.
    const { internal_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(txns);
    const splits = [];
    for (const { id, data: d } of txns) {
        const txn_date_ms = d.transactionDate.toMillis();
        const is_pending = d.isPending === true;
        const txn_is_internal_transfer = internal_ids.has(id);
        const txn_is_income = d.type === "income";
        const raw = (_a = d.splits) !== null && _a !== void 0 ? _a : [];
        for (const s of raw) {
            splits.push((0, on_read_matching_1.map_raw_split_to_on_read_match)(s, {
                txn_date_ms,
                is_pending,
                is_transfer: txn_is_internal_transfer,
                is_income: txn_is_income,
            }));
        }
    }
    // 3. Pure match → the target's owned splits.
    return (0, budget_spend_match_service_1.owned_splits_for_budget)(target_budget_id, real_budgets, ee_id, splits);
}
//# sourceMappingURL=on_read_spend.resolver.js.map