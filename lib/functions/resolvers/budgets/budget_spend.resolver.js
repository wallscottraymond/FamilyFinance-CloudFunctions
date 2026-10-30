"use strict";
/**
 * Budget Spend Resolver
 *
 * READ-ONLY: gather the transaction splits assigned to a budget within a period's
 * date range, mapped to the spend domain's input. Uses a `transactionDate` range
 * query (top-level, indexable) + an in-memory filter on `split.budgetId` — the
 * splits-read constraint (splits are an array of maps and can't be queried by an
 * inner field). Bounded to one period's transactions.
 *
 * Composite index required: `transactions(userId ASC, transactionDate ASC)`.
 *
 * @module resolvers/budgets/budget_spend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_window_txn_loader = create_window_txn_loader;
exports.resolve_spend_splits = resolve_spend_splits;
exports.stored_split_for_spend = stored_split_for_spend;
const edge_transfers_service_1 = require("../../domain/periods/edge_transfers.service");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const on_read_matching_1 = require("../shared/on_read_matching");
const category_semantics_service_1 = require("../../domain/transactions/category_semantics.service");
const category_catalog_resolver_1 = require("../shared/category_catalog.resolver");
const split_category_service_1 = require("../../domain/transactions/split_category.service");
const split_category_edit_service_1 = require("../../domain/transactions/split_category_edit.service");
/**
 * Per-call memo of window transaction loads. A single recompute touches several budgets whose
 * periods share IDENTICAL date windows (every budget's monthly period is the same month), so
 * each window is read once instead of once per budget. Exact-window keyed → identical results.
 */
function create_window_txn_loader(ctx, user_id, 
/** One read of the user's transactions covering [lo_ms, hi_ms]: any window inside it is sliced
 *  from memory instead of read (a convert touches ~100 windows of one year). Windows outside
 *  it fall back to the per-window read. Same rows, same order. */
preloaded) {
    const memo = new Map();
    return (start_ms, end_ms) => {
        const key = `${start_ms}:${end_ms}`;
        let p = memo.get(key);
        if (!p) {
            p = preloaded && start_ms >= preloaded.lo_ms && end_ms <= preloaded.hi_ms
                ? Promise.resolve(preloaded.txns.filter((t) => {
                    const d = t.data.transactionDate.toMillis();
                    return d >= start_ms && d <= end_ms;
                }))
                : transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, start_ms, end_ms);
            memo.set(key, p);
        }
        return p;
    };
}
/** Which split field carries the budget assignment for each period lens. */
const LENS_FIELD = {
    monthly: "monthlyBudgetId",
    weekly: "weeklyBudgetId",
    bi_monthly: "biWeeklyBudgetId",
};
/**
 * Resolve the spend splits for a (budget, period date range).
 *
 * Per-Period-EE: a split is assigned INDEPENDENTLY per lens, so we match the split
 * field for THIS budget's cadence (`cadence` = the budget's own `period`, applied
 * to all its periods — prime and non-prime). Pre-migration docs only have the
 * legacy `budgetId` (= the monthly assignment), so the monthly lens falls back to
 * it; weekly/bi_monthly match only their own field.
 *
 * @returns Every countable-candidate split assigned to `budget_id` in the range.
 */
async function resolve_spend_splits(ctx, user_id, budget_id, start_ms, end_ms, cadence = "monthly", load_txns) {
    var _a;
    const load = (lo, hi) => load_txns ? load_txns(lo, hi) : transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, lo, hi);
    const txns = await load(start_ms, end_ms);
    // Internal transfers are excluded as on the period page: the stored matched-pair role when the
    // classifier has decided it (it decides per VIEW — an edge_out contribution counts), else live
    // pairing over the period ± the shared slack (as the page pairs). The wider read happens only
    // when a transfer hasn't been classified yet (rare: the classifier runs right after a sync).
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    const needs_live = txns.some((t) => t.data.transferRole === undefined &&
        (0, category_semantics_service_1.is_transfer_category)((0, on_read_matching_1.txn_effective_category)(t.data, catalog)));
    const pool = needs_live
        ? await load(start_ms - edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS, end_ms + edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS)
        : txns;
    const { internal_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(pool, catalog);
    const out = [];
    for (const { id, data: d } of txns) {
        const txn_date_ms = d.transactionDate.toMillis();
        const is_pending = d.isPending === true;
        const role = d.transferRole;
        const txn_is_internal_transfer = role !== undefined ? role === "internal" : internal_ids.has(id);
        const txn_is_income = d.type === "income";
        const splits = (_a = d.splits) !== null && _a !== void 0 ? _a : [];
        for (const s of splits) {
            const spend = stored_split_for_spend(s, d, budget_id, cadence, catalog, {
                txn_date_ms,
                is_pending,
                is_transfer: txn_is_internal_transfer,
                is_income: txn_is_income,
            });
            if (spend)
                out.push(spend);
        }
    }
    return out;
}
/**
 * One STORED split → the spend domain's input for `budget_id` in `cadence`'s lens, or null when
 * the split isn't stored in that budget. PURE — the stored half of "stored == derived" (the
 * property test runs it against the engine and the period page).
 */
function stored_split_for_spend(s, txn, budget_id, cadence, catalog, t) {
    var _a, _b, _c;
    // The split's assignment in this budget's lens; monthly falls back to the legacy `budgetId`
    // for pre-migration docs.
    let assigned = s[LENS_FIELD[cadence]];
    if (assigned === undefined && cadence === "monthly") {
        assigned = s.budgetId;
    }
    if (assigned !== budget_id)
        return null;
    // The category's meaning from the ONE category function (a user pick away from income makes
    // it spending).
    const effective_category = (0, split_category_service_1.resolve_split_category)((0, split_category_edit_service_1.split_category_input_from_raw)(s, txn, catalog), catalog).semantic_code;
    // A manual pin counts in its budget whatever the money is (canon A4) — as on the page. The
    // engine stores a pin per lens (an Everything Else pin → each lens's own EE), so the pin is
    // "here" when this lens's stored budget is this budget.
    const pinned = s.budgetAssignmentSource === "manual";
    return {
        budget_id,
        amount: (_a = s.amount) !== null && _a !== void 0 ? _a : 0,
        txn_date_ms: t.txn_date_ms,
        is_pending: t.is_pending,
        // The internal-transfer flag applies only while this split's category is a transfer (as the
        // engine and the page decide per split).
        is_transfer: !pinned && t.is_transfer && (0, category_semantics_service_1.is_transfer_category)(effective_category),
        is_income: t.is_income,
        is_income_category: !pinned && (0, budget_spend_service_1.is_income_category)(effective_category),
        // Derive on read (no migration): explicit spendStatus wins, else fall back to the legacy
        // isIgnored/isRefund booleans, else 'counted'.
        spend_status: (0, budget_spend_service_1.split_spend_status)(s),
        outflow_id: (_b = s.outflowId) !== null && _b !== void 0 ? _b : null,
        inflow_id: (_c = s.inflowId) !== null && _c !== void 0 ? _c : null,
    };
}
//# sourceMappingURL=budget_spend.resolver.js.map