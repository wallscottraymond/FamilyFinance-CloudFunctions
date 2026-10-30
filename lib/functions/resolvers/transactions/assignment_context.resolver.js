"use strict";
/**
 * Assignment Context Resolver
 *
 * READ-ONLY: loads everything the Transaction Assignment Engine needs to assign
 * one transaction's splits — the transaction, the user's real budgets (+ the
 * Everything Else id), the source periods overlapping the date, and the category
 * rules — and maps them to the pure core's input types.
 *
 * Recurring matches are NOT resolved here yet (owned by Recurring-Period-
 * Reconciliation); `recurring_by_split` is left empty until that ships.
 *
 * @module resolvers/transactions/assignment_context
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_shared_assignment_context = resolve_shared_assignment_context;
exports.resolve_assignment_context = resolve_assignment_context;
const capture_rules_1 = require("../../domain/recurring/capture_rules");
const converted_match_service_1 = require("../../domain/recurring/converted_match.service");
const vendor_key_service_1 = require("../../domain/transactions/vendor_key.service");
const match_budgets_service_1 = require("../../domain/budgets/match_budgets.service");
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const account_repo_1 = require("../../repositories/account.repo");
const user_repo_1 = require("../../repositories/user.repo");
const sharing_1 = require("../../repositories/sharing");
const group_service_1 = require("../../domain/sharing/group.service");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const category_repo_1 = require("../../repositories/category.repo");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const feature_flag_repo_1 = require("../../repositories/feature_flag.repo");
const review_holdout_resolver_1 = require("../recurring/review_holdout.resolver");
const stream_membership_1 = require("../../domain/recurring/stream_membership");
const late_payment_service_1 = require("../../domain/recurring/late_payment.service");
const stream_membership_2 = require("../../domain/recurring/stream_membership");
const period_reconciliation_service_1 = require("../../domain/recurring/period_reconciliation.service");
const split_category_edit_service_1 = require("../../domain/transactions/split_category_edit.service");
const split_category_service_1 = require("../../domain/transactions/split_category.service");
const recurring_matches_resolver_1 = require("./recurring_matches.resolver");
/**
 * Resolve the transaction-independent shared context for a user (budgets +
 * categories). Loaded once per batch; pass into `resolve_assignment_context` to
 * skip the per-transaction re-reads.
 */
async function resolve_shared_assignment_context(ctx, user_id) {
    var _a, _b, _c, _d, _e, _f;
    // Budgets (per-user) and category rules (cached reference data) are
    // independent — fetch concurrently.
    // The flag check (cached per instance) runs alongside the reads; the review state doc is read
    // only for a flag-on user or one with v2 records (X11: no extra read for anyone else).
    const flag_on = feature_flag_repo_1.feature_flag_repo.is_convert_to_recurring_enabled(user_id);
    const [budgets, category_docs, outflows, inflows] = await Promise.all([
        budget_repo_1.budget_repo.get_by_user_id(ctx, user_id),
        category_repo_1.category_repo.get_active_cached(ctx),
        outflow_repo_1.outflow_repo.get_by_user_id(ctx, user_id),
        inflow_repo_1.inflow_repo.get_by_user_id(ctx, user_id),
    ]);
    const review_state = await (0, review_holdout_resolver_1.load_review_state_if_relevant)(ctx, user_id, [...outflows, ...inflows], flag_on);
    // Authoritative recurring-stream links: Plaid stream `transactionIds` → recurring id.
    // Only ACTIVE, non-hidden defs (hidden = classified internal transfer) contribute, so
    // a txn is linked to a bill/income exactly as the derive-on-read read path does. A txn
    // claimed by two streams is excluded (no guessing — see build_stream_membership_map).
    const outflow_tx_to_id = (0, stream_membership_1.build_stream_membership_map)(outflows.filter((o) => o.is_active && !o.is_hidden));
    const inflow_tx_to_id = (0, stream_membership_1.build_stream_membership_map)(inflows.filter((i) => i.is_active && !i.is_hidden));
    // The `categories` collection as the one category function needs it (canon M7).
    const category_catalog = (0, split_category_service_1.build_category_catalog)(category_docs);
    // Real budgets (+ the Everything Else id PER LENS for the structural fallback).
    const { real_budgets, budget_names, everything_else_budget_ids } = build_view_budgets(budgets);
    const group_views_by_account = await resolve_group_views(ctx, user_id);
    // Which VIEW each bill / income belongs to (Account-Rooted-Sharing): a group's when its account
    // is shared with one, else Me (null). A transaction links only to bills in ITS view — the
    // period page drops a link to another view's bill and counts the money as ordinary spending.
    const recurring_view_by_id = new Map();
    for (const r of [...outflows, ...inflows]) {
        recurring_view_by_id.set(r.id, (_c = (_b = group_views_by_account.get((_a = r.account_id) !== null && _a !== void 0 ? _a : "")) === null || _b === void 0 ? void 0 : _b.group_id) !== null && _c !== void 0 ? _c : null);
    }
    const active_outflow_ids = new Set(outflows.filter((o) => o.is_active && !o.is_hidden).map((o) => o.id));
    const active_inflow_ids = new Set(inflows.filter((i) => i.is_active && !i.is_hidden).map((i) => i.id));
    const removal_intervals_by_id = new Map();
    for (const r of [...outflows, ...inflows]) {
        if ((_d = r.removal_intervals) === null || _d === void 0 ? void 0 : _d.length)
            removal_intervals_by_id.set(r.id, r.removal_intervals);
    }
    const release_schedule_by_id = new Map();
    for (const o of outflows) {
        if ((_e = o.removal_intervals) === null || _e === void 0 ? void 0 : _e.length)
            release_schedule_by_id.set(o.id, (0, late_payment_service_1.bill_release_schedule)(o));
    }
    const bill_payments_memo = new Map();
    const load_bill_payments_for_release = (recurring_id) => {
        var _a;
        const hit = bill_payments_memo.get(recurring_id);
        if (hit)
            return hit;
        const o = outflows.find((x) => x.id === recurring_id);
        const p = load_bill_payments(ctx, user_id, recurring_id, (_a = o === null || o === void 0 ? void 0 : o.transaction_ids) !== null && _a !== void 0 ? _a : []);
        bill_payments_memo.set(recurring_id, p);
        return p;
    };
    const v2_account_by_recurring_id = new Map();
    for (const r of [...outflows, ...inflows]) {
        if ((0, capture_rules_1.is_v2_record)(r) && r.account_id)
            v2_account_by_recurring_id.set(r.id, r.account_id);
    }
    // Payments of streams a converted bill absorbed (D42): their own map, judged by the D1 floors.
    const absorbed_of = (list) => (0, stream_membership_1.build_stream_membership_map)(list.filter((r) => { var _a; return r.is_active && !r.is_hidden && ((_a = r.absorbed_txn_ids) === null || _a === void 0 ? void 0 : _a.length); })
        .map((r) => ({ id: r.id, transaction_ids: r.absorbed_txn_ids })));
    const converted_index = (0, converted_match_service_1.build_converted_index)([
        ...outflows.map((o) => as_converted_input(o, "outflow")),
        ...inflows.map((i) => as_converted_input(i, "inflow")),
    ]);
    return {
        real_budgets,
        budget_names,
        everything_else_budget_ids,
        category_catalog,
        outflow_tx_to_id,
        inflow_tx_to_id,
        group_views_by_account,
        recurring_view_by_id,
        active_outflow_ids,
        active_inflow_ids,
        removal_intervals_by_id,
        release_schedule_by_id,
        load_bill_payments_for_release,
        fuzzy_excluded_plaid_ids: new Set((_f = review_state === null || review_state === void 0 ? void 0 : review_state.suppressed_txn_ids) !== null && _f !== void 0 ? _f : []),
        v2_account_by_recurring_id,
        converted_index,
        outflow_absorbed_tx_to_id: absorbed_of(outflows),
        inflow_absorbed_tx_to_id: absorbed_of(inflows),
    };
}
function as_converted_input(r, direction) {
    var _a, _b, _c;
    return {
        id: r.id,
        direction,
        is_active: r.is_active,
        is_hidden: r.is_hidden,
        merged_into_id: r.merged_into_id,
        capture_rules_version: r.capture_rules_version,
        source: r.source,
        vendor_key: r.vendor_key,
        account_id: r.account_id,
        average_amount: r.average_amount,
        expected_amount_override: r.expected_amount_override,
        first_date_ms: (_c = (_b = (_a = r.first_date) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : 0,
        converted_at_ms: r.converted_at_ms,
        retro_txn_ids: r.retro_txn_ids,
    };
}
/** The transaction's vendor key: the stored one, else computed exactly as the stored one is. */
function txn_vendor_key(data) {
    const stored = data.vendorKey;
    if (typeof stored === "string" && stored.length > 0)
        return stored;
    return (0, vendor_key_service_1.vendor_key)({
        merchant_name: data.merchantName,
        name: data.name,
        description: data.description,
    });
}
/**
 * D37: a bill's stored payments — the transactions linked to it by split (`splitOutflowIds`) plus
 * its Plaid stream's, each the net of the splits paying it (stored reconcile's sources and rule).
 */
async function load_bill_payments(ctx, user_id, recurring_id, stream_plaid_ids) {
    var _a, _b, _c, _d;
    const [link_txns, stream_txns] = await Promise.all([
        transaction_repo_1.transaction_repo.get_by_split_recurring_link(ctx, user_id, "outflow", recurring_id),
        transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, stream_plaid_ids),
    ]);
    const stream_ids = new Set(stream_txns.map((t) => t.id));
    const seen = new Set();
    const out = [];
    for (const t of [...link_txns, ...stream_txns]) {
        if (!t.id || seen.has(t.id) || t.isActive === false)
            continue;
        seen.add(t.id);
        const paying = (0, stream_membership_2.is_edge_money)(t.transferRole)
            ? []
            : (0, stream_membership_2.splits_paying_recurring)((_a = t.splits) !== null && _a !== void 0 ? _a : [], "outflow", recurring_id, stream_ids.has(t.id));
        if (paying.length === 0)
            continue;
        out.push({
            id: t.id,
            date_ms: (_d = (_c = (_b = t.transactionDate) === null || _b === void 0 ? void 0 : _b.toMillis) === null || _c === void 0 ? void 0 : _c.call(_b)) !== null && _d !== void 0 ? _d : 0,
            amount: (0, period_reconciliation_service_1.compute_countable_split_net)(paying, t.id).amount,
        });
    }
    return out;
}
/**
 * A view's budgets → what the engine matches: real budgets + the Everything Else id PER LENS.
 * A budget's period maps to exactly one lens; the three EE budgets are keyed by their own lens.
 */
function build_view_budgets(budgets) {
    // THE budget set (domain/budgets/match_budgets) — the period page builds the same one, so the
    // stored budget equals the counted one (canon A11): snapped start, `budget_end_date`, every
    // cadence owning its categories in every lens, one Everything Else per lens.
    const match = (0, match_budgets_service_1.build_match_budgets)(budgets.map(match_budgets_service_1.budget_to_match_input));
    return {
        real_budgets: match.real_budgets,
        budget_names: match.names,
        everything_else_budget_ids: match.everything_else_ids,
    };
}
/**
 * The user's accounts placed in a group they belong to → that group's budgets (by doc + Plaid
 * account id). Same membership rule as `resolve_derive_scope` (a stale placement counts in Me).
 * Empty — and no extra reads beyond the user doc — for someone in no groups.
 */
async function resolve_group_views(ctx, user_id) {
    var _a, _b;
    const out = new Map();
    const user = await user_repo_1.user_repo.get_by_id(ctx, user_id);
    const group_ids = (_a = user === null || user === void 0 ? void 0 : user.data.groupIds) !== null && _a !== void 0 ? _a : [];
    if (group_ids.length === 0)
        return out;
    const [accounts, groups] = await Promise.all([
        account_repo_1.account_repo.get_by_user_id(ctx, user_id),
        sharing_1.group_repo.get_many(ctx, group_ids),
    ]);
    const member_of = new Set(groups.filter((g) => (0, group_service_1.is_member)(g, user_id)).map((g) => g.id));
    const placed = accounts.filter((a) => a.placement && member_of.has(a.placement.group_id));
    if (placed.length === 0)
        return out;
    const views = new Map();
    await Promise.all([...new Set(placed.map((a) => a.placement.group_id))].map(async (gid) => {
        views.set(gid, build_view_budgets(await budget_repo_1.budget_repo.get_by_user_id(ctx, `group:${gid}`)));
    }));
    for (const a of placed) {
        const view = views.get(a.placement.group_id);
        if (!view)
            continue;
        const entry = {
            from_ms: (_b = a.placement.shared_from_ms) !== null && _b !== void 0 ? _b : null,
            group_id: a.placement.group_id,
            view,
        };
        out.set(a.id, entry);
        if (a.account_id)
            out.set(a.account_id, entry);
    }
    return out;
}
/**
 * Resolve the assignment context for a transaction.
 *
 * @param shared - Optional pre-resolved shared context (budgets + categories).
 *   When provided (batch path), the per-transaction budget/category reads are
 *   skipped; only the transaction doc, its overlapping source periods, and its
 *   recurring matches are read.
 * @returns The resolved context, or null if the transaction is missing/inactive.
 */
async function resolve_assignment_context(ctx, user_id, transaction_id, shared, preloaded_candidates, 
// Batch path: the txn doc + the source periods overlapping the batch's date span, both read ONCE
// for the whole batch. When present, the per-transaction `get_raw_by_id` + `get_overlapping`
// reads are skipped (filtered in memory) — the remaining O(N)/sync reads this path eliminates.
preloaded_txn, preloaded_source_periods) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_assignment_context");
    (0, observability_1.log_operation_start)(span, user_id);
    const txn = preloaded_txn !== null && preloaded_txn !== void 0 ? preloaded_txn : (await transaction_repo_1.transaction_repo.get_raw_by_id(ctx, transaction_id));
    if (!txn) {
        return null;
    }
    const data = txn.data;
    const txn_date_ms = data.transactionDate.toMillis();
    const raw_splits = (_a = data.splits) !== null && _a !== void 0 ? _a : [];
    const txn_merchant_name = (_b = data.merchantName) !== null && _b !== void 0 ? _b : null;
    const txn_type = (_c = data.type) !== null && _c !== void 0 ? _c : "expense";
    // Transaction-independent context: reuse the caller's shared slice (batch) or
    // resolve it now (single-item path). Resolve it FIRST because the recurring
    // matcher needs its authoritative stream maps; the two transaction-DEPENDENT
    // reads (source periods + recurring matches) then run concurrently.
    const anchor = firestore_1.Timestamp.fromMillis(txn_date_ms);
    const txn_plaid_id = (_d = data.transactionId) !== null && _d !== void 0 ? _d : null;
    const resolved_shared = shared !== null && shared !== void 0 ? shared : (await resolve_shared_assignment_context(ctx, user_id));
    // Recurring matches (uses preloaded candidates on the batch path) run concurrently with the
    // source-period resolution below.
    const recurring_by_split_promise = (0, recurring_matches_resolver_1.resolve_recurring_matches)(ctx, user_id, txn_type, txn_merchant_name, txn_date_ms, raw_splits.map((s) => {
        var _a;
        return ({
            split_id: s.splitId,
            amount: (_a = s.amount) !== null && _a !== void 0 ? _a : 0,
        });
    }), {
        txn_plaid_id,
        outflow_tx_to_id: resolved_shared.outflow_tx_to_id,
        inflow_tx_to_id: resolved_shared.inflow_tx_to_id,
        preloaded_candidates,
        fuzzy_excluded_plaid_ids: resolved_shared.fuzzy_excluded_plaid_ids,
        v2_account_by_recurring_id: resolved_shared.v2_account_by_recurring_id,
        txn_account_id: (_e = data.accountId) !== null && _e !== void 0 ? _e : null,
        converted_index: resolved_shared.converted_index,
        txn_vendor_key: txn_vendor_key(data),
        txn_created_ms: (_h = (_g = (_f = data.createdAt) === null || _f === void 0 ? void 0 : _f.toMillis) === null || _g === void 0 ? void 0 : _g.call(_f)) !== null && _h !== void 0 ? _h : null,
        absorbed_tx_to_id: txn_type === "income" ? resolved_shared.inflow_absorbed_tx_to_id : resolved_shared.outflow_absorbed_tx_to_id,
    });
    // Source periods overlapping the transaction date. Batch path: filter the ONCE-preloaded set in
    // memory (no read). Single-item path: query the overlapping periods (`source_periods` is a
    // global calendar collection — a per-txn read here was O(N)/sync).
    const source_periods = preloaded_source_periods
        ? preloaded_source_periods.filter((p) => p.start_ms <= txn_date_ms && txn_date_ms <= p.end_ms)
        : (await source_period_repo_1.source_period_repo.get_overlapping(ctx, anchor, anchor)).map((p) => ({
            id: p.id,
            type: p.period_type,
            start_ms: p.start_date.toMillis(),
            end_ms: p.end_date.toMillis(),
        }));
    // Which view this transaction counts in: a shared account's group (from its share-from date
    // on), else the user's own budgets.
    const placed = resolved_shared.group_views_by_account.get((_j = data.accountId) !== null && _j !== void 0 ? _j : "");
    const in_group = !!placed && (placed.from_ms === null || txn_date_ms >= placed.from_ms);
    const view = in_group ? placed.view : resolved_shared;
    const view_group_id = in_group ? placed.group_id : null;
    // …and a bill / income removed or paused for this payment's month isn't paid by it either: the
    // money counts as ordinary spending / money in (the period page applies the same rule).
    const of_view = (recurring_id) => { var _a; return ((_a = resolved_shared.recurring_view_by_id.get(recurring_id)) !== null && _a !== void 0 ? _a : null) === view_group_id; };
    // D31 / D37: a bill's late payment of its last occurrence before the cut-off is not released
    // while that occurrence is still unpaid — judged by the bill's stored payments, loaded only for
    // a transaction that may be such a late payment.
    const release_payments = new Map();
    for (const [rid, schedule] of (_k = resolved_shared.release_schedule_by_id) !== null && _k !== void 0 ? _k : []) {
        const intervals = (_l = resolved_shared.removal_intervals_by_id) === null || _l === void 0 ? void 0 : _l.get(rid);
        if (!(0, late_payment_service_1.is_late_payment_candidate)(intervals, txn_date_ms, schedule))
            continue;
        release_payments.set(rid, (_o = (await ((_m = resolved_shared.load_bill_payments_for_release) === null || _m === void 0 ? void 0 : _m.call(resolved_shared, rid)))) !== null && _o !== void 0 ? _o : []);
    }
    const released = (recurring_id) => {
        var _a, _b, _c;
        const schedule = (_a = resolved_shared.release_schedule_by_id) === null || _a === void 0 ? void 0 : _a.get(recurring_id);
        return (0, late_payment_service_1.is_payment_released)((_b = resolved_shared.removal_intervals_by_id) === null || _b === void 0 ? void 0 : _b.get(recurring_id), { id: txn.id, date_ms: txn_date_ms }, schedule ? { schedule, payments: (_c = release_payments.get(recurring_id)) !== null && _c !== void 0 ? _c : [] } : null);
    };
    const in_view = (recurring_id) => !recurring_id || (of_view(recurring_id) && !released(recurring_id));
    // A link to a bill / income of ANOTHER view isn't this view's bill payment — the period page
    // drops it and counts the money here as ordinary spending; the engine does the same.
    // …except that a stream-member payment whose bill is another view's still pays an in-view
    // converted bill of its key (D1's `d1_alt`): the stream target is dropped, the D1 one is kept.
    const recurring_by_split = Object.fromEntries(Object.entries(await recurring_by_split_promise).map(([split_id, m]) => {
        var _a;
        const alt = (_a = m.d1_alt_id) !== null && _a !== void 0 ? _a : null;
        const outflow_ok = in_view(m.outflow_id);
        const inflow_ok = in_view(m.inflow_id);
        const alt_ok = !!alt && in_view(alt);
        return [
            split_id,
            {
                outflow_id: outflow_ok ? m.outflow_id : (m.outflow_id && alt_ok && m.d1_alt_kind === "outflow" ? alt : null),
                inflow_id: inflow_ok ? m.inflow_id : (m.inflow_id && alt_ok && m.d1_alt_kind === "inflow" ? alt : null),
            },
        ];
    }));
    // Manual bill pins are honoured only for live bills in this view (a stale / other-view pin
    // falls back to auto — canon A5).
    const active_outflow_ids = new Set([...resolved_shared.active_outflow_ids].filter((id) => in_view(id)));
    // …and a pin to a bill removed / paused for this month is PARKED, not dropped (Restore).
    const suppressed_outflow_ids = new Set([...resolved_shared.active_outflow_ids].filter((id) => of_view(id) && released(id)));
    // The caller's own incomes in this view (a manual income pin elsewhere is dropped), and the ones
    // removed / paused for this month (kept as stored).
    const active_inflow_ids = new Set([...((_p = resolved_shared.active_inflow_ids) !== null && _p !== void 0 ? _p : [])].filter((id) => in_view(id)));
    const suppressed_inflow_ids = new Set([...((_q = resolved_shared.active_inflow_ids) !== null && _q !== void 0 ? _q : [])].filter((id) => of_view(id) && released(id)));
    const { real_budgets, budget_names, everything_else_budget_ids } = view;
    // The engine's inputs for the ONE category function (canon M7): the immutable Plaid code +
    // the user's pick (`categorySource: "user"` + slugs).
    const catalog = resolved_shared.category_catalog;
    const splits_input = raw_splits.map((s) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
        // The category inputs come from THE raw-split mapper every reader uses (an old reclassify in
        // the legacy fields reads as the user's pick, as the backfill will store it).
        const cat = (0, split_category_edit_service_1.split_category_input_from_raw)(s, data, catalog);
        return {
            split_id: s.splitId,
            budget_id: (_a = s.budgetId) !== null && _a !== void 0 ? _a : "unassigned",
            budget_assignment_source: (_b = s.budgetAssignmentSource) !== null && _b !== void 0 ? _b : "category",
            // Prior per-lens assignments (for the touched-set + skip-if-unchanged). Fall
            // back to the legacy monthly `budgetId` for pre-migration docs.
            monthly_budget_id: (_c = s.monthlyBudgetId) !== null && _c !== void 0 ? _c : undefined,
            weekly_budget_id: (_d = s.weeklyBudgetId) !== null && _d !== void 0 ? _d : undefined,
            bi_weekly_budget_id: (_e = s.biWeeklyBudgetId) !== null && _e !== void 0 ? _e : undefined,
            plaid_match_category: (_f = s.plaidDetailedCategory) !== null && _f !== void 0 ? _f : "OTHER_EXPENSE",
            outflow_id: (_g = s.outflowId) !== null && _g !== void 0 ? _g : null,
            // Manual bill-pin source — preserved so a user's bill assignment survives re-sync.
            outflow_source: (_h = s.outflowAssignmentSource) !== null && _h !== void 0 ? _h : "auto",
            suspended_outflow_pin: (_j = s.suspendedOutflowPinId) !== null && _j !== void 0 ? _j : null,
            inflow_id: (_k = s.inflowId) !== null && _k !== void 0 ? _k : null,
            inflow_source: (_l = s.inflowAssignmentSource) !== null && _l !== void 0 ? _l : "auto",
            monthly_period_id: (_m = s.monthlyPeriodId) !== null && _m !== void 0 ? _m : null,
            weekly_period_id: (_o = s.weeklyPeriodId) !== null && _o !== void 0 ? _o : null,
            bi_weekly_period_id: (_p = s.biWeeklyPeriodId) !== null && _p !== void 0 ? _p : null,
            // App-category classification: prior slugs + source (preserved when "user").
            overall_category_id: (_q = cat.overall_category_id) !== null && _q !== void 0 ? _q : null,
            first_category_id: (_r = cat.first_category_id) !== null && _r !== void 0 ? _r : null,
            second_category_id: (_s = cat.second_category_id) !== null && _s !== void 0 ? _s : null,
            category_source: (_t = cat.category_source) !== null && _t !== void 0 ? _t : "plaid",
        };
    });
    const context = {
        txn_date_ms,
        txn_merchant_name,
        txn_name: (_r = data.name) !== null && _r !== void 0 ? _r : null,
        txn_is_income: txn_type === "income",
        txn_transfer_role: (_s = data.transferRole) !== null && _s !== void 0 ? _s : null,
        real_budgets,
        everything_else_budget_ids,
        category_catalog: resolved_shared.category_catalog,
        source_periods,
        recurring_by_split,
        active_outflow_ids,
        suppressed_outflow_ids,
        active_inflow_ids,
        suppressed_inflow_ids,
    };
    (0, observability_1.log_operation_success)(span, user_id);
    return {
        transaction_doc_id: transaction_id,
        raw_splits,
        splits_input,
        context,
        budget_names,
    };
}
//# sourceMappingURL=assignment_context.resolver.js.map