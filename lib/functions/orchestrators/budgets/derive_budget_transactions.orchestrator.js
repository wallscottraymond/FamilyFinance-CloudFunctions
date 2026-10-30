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
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const view_version_resolver_1 = require("../../resolvers/periods/view_version.resolver");
const derived_result_cache_repo_1 = require("../../repositories/derived_result_cache.repo");
const derive_scope_resolver_1 = require("../../resolvers/periods/derive_scope.resolver");
const edge_transfers_service_1 = require("../../domain/periods/edge_transfers.service");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const derive_scope_service_1 = require("../../domain/periods/derive_scope.service");
const budget_spend_match_service_1 = require("../../domain/budgets/budget_spend_match.service");
const match_budgets_service_1 = require("../../domain/budgets/match_budgets.service");
const category_catalog_resolver_1 = require("../../resolvers/shared/category_catalog.resolver");
const transaction_card_service_1 = require("../../domain/transactions/transaction_card.service");
const on_read_matching_1 = require("../../resolvers/shared/on_read_matching");
// widen the window so cross-day transfer pairs match — THE shared slack (as the period page and
// the stored transfer roles pair)
const PAIRING_BUFFER_MS = edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
/** L2 cache collection for this callable ([[Firestore-Read-Cost-Reduction]] B′). */
const BUDGET_TXN_CACHE = "derived_budget_txn_cache";
/** Result SHAPE version, part of the cache key: bump whenever the row shape changes so a cached
 *  result in the old shape (24h TTL) is never served. v2 = rows carry `card`. */
const BUDGET_TXN_CACHE_SHAPE = "v2";
async function derive_budget_transactions_orchestrator(ctx, user_id, budget_id, start_ms, end_ms, force = false, scope_request) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    // 0. Cache key + version per VIEW (Account-Rooted-Sharing): Me exactly as before; a group =
    //    "group:<id>" with a members-aware version (membership checked even on a cache hit).
    const view_key = (0, view_version_resolver_1.view_key_for)(user_id, scope_request);
    // L2 CACHE: serve the version-matched result (2 reads) instead of the ~348-doc window read
    // + derivation. Correctness = version match (bumped on every budget/txn write); the cache
    // stamp uses the version read BEFORE compute so a mid-compute bump forces the next miss.
    const cache_id = `${view_key}__${budget_id}__${start_ms}__${end_ms}__${BUDGET_TXN_CACHE_SHAPE}`;
    let data_version;
    if (force) {
        data_version = (await (0, view_version_resolver_1.resolve_view_version)(ctx, user_id, scope_request)).version;
    }
    else {
        const [vv, cached] = await Promise.all([
            (0, view_version_resolver_1.resolve_view_version)(ctx, user_id, scope_request),
            (0, derived_result_cache_repo_1.get_cached_result)(BUDGET_TXN_CACHE, cache_id),
        ]);
        data_version = vv.version;
        if (cached &&
            cached.data_version === data_version &&
            Date.now() - cached.computed_at_ms < derived_result_cache_repo_1.DERIVED_CACHE_TTL_MS) {
            return cached.result;
        }
    }
    // The view's scope (only on a miss): Me minus the user's shared accounts, or the group.
    const scope = await (0, derive_scope_resolver_1.resolve_derive_scope)(ctx, user_id, scope_request);
    // 1. Budgets → real budgets (category ownership) + the EE id + is-target-EE.
    const budgets = await budget_repo_1.budget_repo.get_by_user_id(ctx, scope.budget_owner_key);
    // THE budget set (domain/budgets/match_budgets) — same as the period page and the engine.
    const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
    const budget_match = (0, match_budgets_service_1.build_match_budgets)(budgets.map(match_budgets_service_1.budget_to_match_input));
    const real_budgets = budget_match.real_budgets;
    const target_is_ee = budgets.some((b) => b.id === budget_id && b.is_system_everything_else);
    const ee_id = target_is_ee ? budget_id : budget_match.primary_everything_else_id;
    // 2. Load the window's transactions (+ a small buffer for transfer pairing). All members'
    //    transactions are kept server-side for cross-view pairing (D12); the view's are filtered.
    const all_member_txns = (await Promise.all(scope.member_ids.map((m) => transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, m, start_ms - PAIRING_BUFFER_MS, end_ms + PAIRING_BUFFER_MS)))).flat();
    // The VIEW comes only from the members' own transactions…
    const txns = all_member_txns.filter((t) => (0, derive_scope_service_1.transaction_in_scope)(scope, t.data.accountId, t.data.transactionDate.toMillis()));
    // …the pairing pool also covers known group accounts (D12; never counted, added AFTER the
    // view filter so they can't leak into it).
    all_member_txns.push(...(await (0, derive_scope_resolver_1.load_pairing_extra_txns)(ctx, scope, start_ms - PAIRING_BUFFER_MS, end_ms + PAIRING_BUFFER_MS)));
    // 2b. Live bills / income that live in ANOTHER view: a split linked to one of them is this
    //     view's ordinary money (same rule as the period page). Skipped entirely when nothing is
    //     shared, so Me with nothing shared does no extra reads.
    const scoped = scope.include_account_ids !== null || scope.exclude_account_ids.size > 0;
    const out_of_view_ids = new Set();
    if (scoped) {
        const lists = await Promise.all(scope.member_ids.flatMap((m) => [
            outflow_repo_1.outflow_repo.get_by_user_id(ctx, m),
            inflow_repo_1.inflow_repo.get_by_user_id(ctx, m),
        ]));
        for (const r of lists.flat()) {
            if (r.is_active && !r.is_hidden && !(0, derive_scope_service_1.account_in_scope)(scope, r.account_id)) {
                out_of_view_ids.add(r.id);
            }
        }
    }
    // 3. Matched-pair internal-transfer detection over the buffered window, then (two-stage, as
    //    on the period page) the view's leftovers against the members' other accounts → edge money.
    const { internal_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(txns, catalog);
    const crossing = (0, edge_transfers_service_1.find_crossing_transfers)((0, on_read_matching_1.detect_internal_transfers_from_txns)(all_member_txns.filter((t) => !internal_ids.has(t.id)), catalog), internal_ids, txns, (d) => (0, on_read_matching_1.txn_effective_category)(d, catalog));
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
        const is_edge = crossing.ids.has(id);
        const card = (0, transaction_card_service_1.to_card_transaction)(id, data);
        for (const s of raw) {
            const outflow_id = (_b = s.outflowId) !== null && _b !== void 0 ? _b : null;
            const inflow_id = (_c = s.inflowId) !== null && _c !== void 0 ? _c : null;
            // Recurring-linked splits are tracked as bills/income, not budget lines — unless the link
            // points to a bill / income in another view, or this is edge money (D12).
            const linked_here = (outflow_id && !out_of_view_ids.has(outflow_id)) ||
                (inflow_id && !out_of_view_ids.has(inflow_id));
            if (linked_here && !is_edge)
                continue;
            const match = (0, on_read_matching_1.map_raw_split_to_on_read_match)(s, {
                txn_date_ms: date_ms,
                is_pending,
                is_transfer: txn_is_internal_transfer,
                is_income: data.type === "income",
                merchant_name: (_d = data.merchantName) !== null && _d !== void 0 ? _d : null,
                name: (_e = data.name) !== null && _e !== void 0 ? _e : null,
            }, catalog);
            if (is_edge && crossing.out_ids.has(id))
                match.is_edge_out = true;
            // Ownership + counting from the period page's own calls (owned_splits_for_budget →
            // is_countable's flags), so the list agrees with the page: a manually pinned transfer /
            // income-category split counts; an unpaired transfer-category split doesn't.
            const [owned] = (0, budget_spend_match_service_1.owned_splits_for_budget)(budget_id, real_budgets, ee_id, [match], budget_match.everything_else_id_set);
            if (!owned)
                continue;
            // Display status: why it doesn't count (transfer / income / the user's ignore), else the
            // stored status.
            let spend_status = match.spend_status;
            let ignored_reason = null;
            if (owned.is_transfer || owned.is_transfer_category) {
                spend_status = "ignored";
                ignored_reason = "transfer";
            }
            else if (owned.is_income_category) {
                spend_status = "ignored";
                ignored_reason = "income";
            }
            else if (match.spend_status === "ignored") {
                ignored_reason = "manual";
            }
            out.push({
                transaction_id: id,
                split_id: (_g = (_f = s.splitId) !== null && _f !== void 0 ? _f : s.id) !== null && _g !== void 0 ? _g : null,
                date_ms,
                name,
                amount: Math.abs((_h = s.amount) !== null && _h !== void 0 ? _h : 0),
                is_pending,
                spend_status,
                ignored_reason,
                card,
            });
        }
    }
    // Newest first.
    out.sort((a, b) => b.date_ms - a.date_ms);
    // Cache the result stamped with the pre-compute version (fire-and-forget; skips if a heavy
    // budget's list exceeds the size guard, in which case that call just stays uncached).
    (0, observability_1.fire_and_forget)(() => (0, derived_result_cache_repo_1.put_cached_result)(BUDGET_TXN_CACHE, cache_id, data_version, out));
    return out;
}
//# sourceMappingURL=derive_budget_transactions.orchestrator.js.map