"use strict";
/**
 * Period Derivation Resolver (batched)
 *
 * READ-ONLY: load EVERYTHING a period view needs in one batch — the user's
 * budgets (+ their monthly homes), the window's source-period buckets, the
 * window's transaction splits (for on-read budget matching AND recurring
 * reconciliation), and the user's recurring outflows/inflows — so the whole
 * period can be derived in a SINGLE server round-trip instead of one callable
 * per budget/bill/income.
 *
 * Reuses the same pure services as the per-item paths; the win is doing the IO
 * once and looping in memory. No writes.
 *
 * @module resolvers/periods/period_derivation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.monthly_period_load_bounds = monthly_period_load_bounds;
exports.load_period_derivation_raw = load_period_derivation_raw;
exports.shape_period_derivation_deps = shape_period_derivation_deps;
exports.resolve_period_derivation_deps = resolve_period_derivation_deps;
const convert_recurring_service_1 = require("../../domain/recurring/convert_recurring.service");
const recurring_suppression_service_1 = require("../../domain/recurring/recurring_suppression.service");
const late_payment_service_1 = require("../../domain/recurring/late_payment.service");
const period_reconciliation_service_1 = require("../../domain/recurring/period_reconciliation.service");
const firestore_1 = require("firebase-admin/firestore");
const repositories_1 = require("../../repositories");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const goal_repo_1 = require("../../repositories/goal.repo");
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const on_read_matching_1 = require("../shared/on_read_matching");
const edge_transfers_service_1 = require("../../domain/periods/edge_transfers.service");
const stream_membership_1 = require("../../domain/recurring/stream_membership");
const income_slot_amounts_1 = require("../../domain/recurring/income_slot_amounts");
const derive_scope_service_1 = require("../../domain/periods/derive_scope.service");
const derive_scope_resolver_1 = require("./derive_scope.resolver");
const match_budgets_service_1 = require("../../domain/budgets/match_budgets.service");
const category_catalog_resolver_1 = require("../shared/category_catalog.resolver");
const feature_flag_repo_1 = require("../../repositories/feature_flag.repo");
const outflow_pinned_period_repo_1 = require("../../repositories/outflow_pinned_period.repo");
const review_holdout_resolver_1 = require("../recurring/review_holdout.resolver");
/**
 * A budget's amount expressed as a MONTHLY-equivalent, given its home cadence —
 * so a synthesized monthly allocation is right regardless of how the budget was
 * authored. Monthly is the target for everyone; weekly/bi-weekly are converted.
 */
function monthly_equivalent_amount(amount, period) {
    if (period === "weekly")
        return amount * (52 / 12); // ~4.33 weeks / month
    if (period === "bi_monthly")
        return amount * 2; // 2 half-months / month
    return amount; // monthly (and default)
}
/** Exact Firestore Timestamp comparison vs a millis bound (keeps sub-millisecond precision). */
function ts_cmp(ts, ms) {
    const b = firestore_1.Timestamp.fromMillis(ms);
    return ts.seconds !== b.seconds ? ts.seconds - b.seconds : ts.nanoseconds - b.nanoseconds;
}
/**
 * The source periods `source_period_repo.get_overlapping(window_start, window_end)` would return,
 * re-filtered from a wider load with the IDENTICAL predicate (startDate in
 * [start − buffer, end], then end_date ≥ start by millis). Preserves startDate order.
 */
function overlapping_for_window(all, window_start_ms, window_end_ms) {
    const lower_ms = firestore_1.Timestamp.fromMillis(window_start_ms).toMillis() - source_period_repo_1.SOURCE_PERIOD_OVERLAP_BUFFER_MS;
    return all.filter((p) => ts_cmp(p.start_date, lower_ms) >= 0 &&
        ts_cmp(p.start_date, window_end_ms) <= 0 &&
        p.end_date.toMillis() >= firestore_1.Timestamp.fromMillis(window_start_ms).toMillis());
}
/** A window's derivation span: the extent of its view-cadence buckets (or the window itself). */
function derivation_span(overlapping, view_cadence, window_start_ms, window_end_ms) {
    const buckets = overlapping.filter((p) => p.period_type === view_cadence);
    return {
        span_start_ms: buckets.length
            ? Math.min(...buckets.map((b) => b.start_date.toMillis()))
            : window_start_ms,
        span_end_ms: buckets.length
            ? Math.max(...buckets.map((b) => b.end_date.toMillis()))
            : window_end_ms,
    };
}
/**
 * IO half: read everything the given windows need, ONCE. For a single window this issues the same
 * queries the per-window path always did (the inflow-history lookup covers every active,
 * non-hidden inflow's stream ids — a superset that's re-filtered per window).
 */
const DAY_MS = 24 * 60 * 60 * 1000;
/** No source / budget period is longer than this. */
const MAX_PERIOD_MS = 31 * DAY_MS;
/**
 * `periodStart` bounds for the monthly budget periods derivation can use for [range_start,
 * range_end] (Read-Cost-Review-Round-3 #5). `shape_period_derivation_deps` keeps only periods
 * overlapping a window's span; a span is built from source periods overlapping the range, so it
 * lies within [range_start − 31d, range_end + 31d], and a kept period (≤ 31d long) must START in
 * [range_start − 62d, range_end + 31d]. Loading exactly that superset leaves the shaped result
 * IDENTICAL to loading all of the user's monthly periods (incl. the "no stored period → synthesize"
 * fallback, which already looks only at span-overlapping periods).
 */
function monthly_period_load_bounds(range_start_ms, range_end_ms) {
    return [range_start_ms - 2 * MAX_PERIOD_MS, range_end_ms + MAX_PERIOD_MS];
}
/** Runs a per-person read for every member of the scope and concatenates (member order). */
async function per_member(scope, read) {
    const lists = await Promise.all(scope.member_ids.map(read));
    return lists.flat();
}
async function load_period_derivation_raw(ctx, user_id, view_cadence, windows, scope_request) {
    var _a, _b;
    const range_start_ms = Math.min(...windows.map((w) => w.start_ms));
    const range_end_ms = Math.max(...windows.map((w) => w.end_ms));
    // 0. The view (Account-Rooted-Sharing): Me = the caller minus their shared accounts;
    //    a group = its shared accounts (caller must be a member — throws otherwise).
    const scope = await (0, derive_scope_resolver_1.resolve_derive_scope)(ctx, user_id, scope_request);
    // 1. Everything that only needs the view + the requested range, in ONE parallel round-trip.
    // Only the transaction read depends on the derived period spans (computed below).
    const [overlapping, budget_entities, monthly_period_docs, member_recurring, goals_raw, category_catalog,] = await Promise.all([
        repositories_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(range_start_ms), firestore_1.Timestamp.fromMillis(range_end_ms)),
        repositories_1.budget_repo.get_by_user_id(ctx, scope.budget_owner_key),
        budget_period_repo_1.budget_period_repo.get_by_user_and_type_starting_between(ctx, scope.budget_owner_key, "monthly", ...monthly_period_load_bounds(range_start_ms, range_end_ms)),
        // Per member: bills + income, then — chained, only if the member is flag-on or has a v2
        // record — their review state (the fuzzy hold-out). X11: no extra read otherwise.
        per_member(scope, async (m) => {
            const flag_on = feature_flag_repo_1.feature_flag_repo.is_convert_to_recurring_enabled(m);
            const [outs, ins, pins] = await Promise.all([
                repositories_1.outflow_repo.get_by_user_id(ctx, m),
                repositories_1.inflow_repo.get_by_user_id(ctx, m),
                // Bills with a hand-pinned period (one read; usually no docs).
                outflow_pinned_period_repo_1.outflow_pinned_period_repo.get_by_owner(ctx, m),
            ]);
            const st = await (0, review_holdout_resolver_1.load_review_state_if_relevant)(ctx, m, [...outs, ...ins], flag_on);
            return [{ member_id: m, outs, ins, st, pins }];
        }),
        per_member(scope, (m) => goal_repo_1.goal_repo.get_by_user(ctx, m)),
        (0, category_catalog_resolver_1.load_category_catalog)(ctx),
    ]);
    const all_outflows = member_recurring.flatMap((r) => r.outs);
    const all_inflows = member_recurring.flatMap((r) => r.ins);
    const review_states = member_recurring.flatMap((r) => (r.st ? [r.st] : []));
    const fuzzy_excluded_plaid_ids = new Set(review_states.flatMap((st) => st.suppressed_txn_ids));
    // Bills / income / goals follow their account's view (an item with no account stays in Me).
    const outflows = all_outflows.filter((o) => (0, derive_scope_service_1.account_in_scope)(scope, o.account_id));
    const inflows = all_inflows.filter((i) => (0, derive_scope_service_1.account_in_scope)(scope, i.account_id));
    const out_of_view_recurring = { ids: new Set(), stream_txn_ids: new Set() };
    for (const r of [...all_outflows, ...all_inflows]) {
        if ((0, derive_scope_service_1.account_in_scope)(scope, r.account_id))
            continue;
        // Only live items that would show in their own view. A link to an inactive / hidden item is
        // a stale link and keeps today's behavior (counted nowhere), so nothing changes for it.
        if (!r.is_active || r.is_hidden)
            continue;
        out_of_view_recurring.ids.add(r.id);
        for (const t of (_a = r.transaction_ids) !== null && _a !== void 0 ? _a : [])
            out_of_view_recurring.stream_txn_ids.add(t);
    }
    const all_goals = goals_raw.filter((g) => (0, derive_scope_service_1.account_in_scope)(scope, g.linked_account_id));
    // 2. Transactions for the UNION of every window's span (one query).
    const spans = windows.map((w) => derivation_span(overlapping_for_window(overlapping, w.start_ms, w.end_ms), view_cadence, w.start_ms, w.end_ms));
    // Padded by the transfer pairing slack: a transfer's other leg just outside the span still
    // pairs (only the span is counted — see shape).
    const txn_start_ms = Math.min(...spans.map((sp) => sp.span_start_ms)) - edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
    // D31: a removed / paused / ended bill's last occurrence may be paid up to 7 days AFTER the
    // span (due Sep 29, paid Oct 2, removed from Oct 1) — that payment pays it in this view; the
    // read reaches that far only when some bill has a removal (no extra read for anyone else).
    const late_reach_ms = outflows.some((o) => { var _a; return (_a = o.removal_intervals) === null || _a === void 0 ? void 0 : _a.length; })
        ? Math.max(0, late_payment_service_1.LATE_PAYMENT_MAX_MS - edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS)
        : 0;
    const txn_end_ms = Math.max(...spans.map((sp) => sp.span_end_ms)) + edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS + late_reach_ms;
    // D37: a payment in the range may be a removed bill's LATE payment (made within 7 days after a
    // cut-off); whether the occurrence it pays was already paid is judged from the bill's payments
    // up to 21 days before the cut-off (LATE_PAYMENT_MAX_MS + LATE_PAYMENT_LOOKBACK_MS). The same
    // query reaches back that far — only when such a cut-off is near the range's start; the part
    // before the range feeds the release rule only.
    let lookback_start_ms = txn_start_ms;
    for (const o of outflows) {
        for (const iv of (_b = o.removal_intervals) !== null && _b !== void 0 ? _b : []) {
            const f = new Date(iv.from_ms);
            const cut_ms = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 1); // month-snapped (earliest)
            if (cut_ms + late_payment_service_1.LATE_PAYMENT_MAX_MS < txn_start_ms || cut_ms > txn_end_ms)
                continue;
            lookback_start_ms = Math.min(lookback_start_ms, cut_ms - late_payment_service_1.LATE_PAYMENT_MAX_MS - late_payment_service_1.LATE_PAYMENT_LOOKBACK_MS);
        }
    }
    // Bills with a payment hand-pinned into one of the loaded periods: their linked payments are read
    // whole (the pinned one may be dated anywhere). The same query stored reconcile uses.
    const loaded_period_ids = new Set(overlapping.map((p) => p.id));
    const pinned_by_member = new Map(member_recurring.map((r) => [r.member_id, r.pins]));
    const pinned_bills = outflows.filter((o) => {
        var _a, _b;
        return o.is_active && !o.is_hidden &&
            ((_b = (_a = pinned_by_member.get(o.user_id)) === null || _a === void 0 ? void 0 : _a.get(o.id)) !== null && _b !== void 0 ? _b : []).some((id) => loaded_period_ids.has(id));
    });
    const [member_txns_read, pairing_extra, pinned_bill_docs] = await Promise.all([
        per_member(scope, (m) => transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, m, lookback_start_ms, txn_end_ms)),
        (0, derive_scope_resolver_1.load_pairing_extra_txns)(ctx, scope, txn_start_ms, txn_end_ms),
        Promise.all(pinned_bills.map((o) => transaction_repo_1.transaction_repo.get_by_split_recurring_link(ctx, o.user_id, "outflow", o.id))),
    ]);
    const pinned_seen = new Set();
    const pinned_bill_txns = pinned_bill_docs
        .flat()
        .filter((d) => {
        var _a;
        if (pinned_seen.has(d.id))
            return false;
        pinned_seen.add(d.id);
        // Any date (an old record may lack a Timestamp): never let one bad doc break the page.
        if (typeof ((_a = d.transactionDate) === null || _a === void 0 ? void 0 : _a.toMillis) !== "function")
            return false;
        return (0, derive_scope_service_1.transaction_in_scope)(scope, d.accountId, d.transactionDate.toMillis());
    })
        .map((d) => ({ id: d.id, data: d }));
    const before_range = (t) => ts_cmp(t.data.transactionDate, txn_start_ms) < 0;
    const member_txns = lookback_start_ms < txn_start_ms
        ? member_txns_read.filter((t) => !before_range(t))
        : member_txns_read;
    const release_lookback_txns = lookback_start_ms < txn_start_ms
        ? member_txns_read.filter((t) => before_range(t) && (0, derive_scope_service_1.transaction_in_scope)(scope, t.data.accountId, t.data.transactionDate.toMillis()))
        : [];
    // Pairing pool: the members' transactions plus known group accounts (never counted).
    const all_member_txns = [...member_txns, ...pairing_extra];
    const txns = member_txns.filter((t) => (0, derive_scope_service_1.transaction_in_scope)(scope, t.data.accountId, t.data.transactionDate.toMillis()));
    // 3. Income history for every candidate inflow stream (superset; re-filtered per window).
    const history_ids = [
        ...new Set(inflows
            .filter((i) => i.is_active && !i.is_hidden)
            .flatMap((i) => { var _a; return (_a = i.transaction_ids) !== null && _a !== void 0 ? _a : []; })),
    ];
    const inflow_history_docs = (await per_member(scope, (m) => transaction_repo_1.transaction_repo.get_by_plaid_transaction_ids(ctx, m, history_ids))).filter((d) => (0, derive_scope_service_1.transaction_in_scope)(scope, d.accountId, d.transactionDate.toMillis()));
    return Object.assign(Object.assign(Object.assign({ overlapping,
        budget_entities,
        monthly_period_docs,
        outflows,
        inflows,
        all_goals,
        txns,
        all_member_txns }, (release_lookback_txns.length ? { release_lookback_txns } : {})), (pinned_bill_txns.length ? { pinned_bill_txns } : {})), { inflow_history_docs,
        scope,
        out_of_view_recurring,
        category_catalog,
        fuzzy_excluded_plaid_ids });
}
/**
 * Lookup/shaping half (NO IO): build ONE window's derivation inputs from a raw load, applying the
 * same predicates the per-window queries apply — so the result is identical to loading that
 * window alone.
 */
/** Splits with every bill / income link removed (edge money isn't a bill or a paycheck). */
function without_recurring_links(splits) {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    return splits.map((s) => (Object.assign(Object.assign({}, s), { outflowId: null, inflowId: null })));
}
/**
 * A held-out payment's (X3) bill / income links that the user didn't make are dropped: an auto
 * `outflowId` (a merchant guess, or a stale one) and any `inflowId` (no manual income pin exists
 * yet). A manual bill pin or a "remove from bill" detach is kept — the user's choice wins.
 */
function without_guessed_links(splits, converted_ids) {
    // Phase 2 (D1): an auto link to a CONVERTED bill / income is the engine's own deterministic
    // key match (it runs before the hold-out), not a merchant guess — kept, like a pin.
    const keep = (id) => typeof id === "string" && converted_ids && converted_ids.has(id) ? id : null;
    /* eslint-disable @typescript-eslint/naming-convention */
    return splits.map((s) => {
        var _a, _b;
        return (Object.assign(Object.assign({}, s), { outflowId: s.outflowAssignmentSource === "manual" ? (_a = s.outflowId) !== null && _a !== void 0 ? _a : null : keep(s.outflowId), 
            // A manual income pin is the user's choice, kept like a manual bill pin.
            inflowId: s.inflowAssignmentSource === "manual" ? (_b = s.inflowId) !== null && _b !== void 0 ? _b : null : keep(s.inflowId) }));
    });
    /* eslint-enable @typescript-eslint/naming-convention */
}
/** Splits with links to out-of-view bills / income removed (same objects when nothing to do). */
function without_out_of_view_links(splits, out_of_view_ids) {
    if (out_of_view_ids.size === 0)
        return splits;
    return splits.map((s) => {
        const o = s.outflowId;
        const i = s.inflowId;
        if ((o && out_of_view_ids.has(o)) || (i && out_of_view_ids.has(i))) {
            /* eslint-disable @typescript-eslint/naming-convention */
            return Object.assign(Object.assign({}, s), { outflowId: o && out_of_view_ids.has(o) ? null : o !== null && o !== void 0 ? o : null, inflowId: i && out_of_view_ids.has(i) ? null : i !== null && i !== void 0 ? i : null });
            /* eslint-enable @typescript-eslint/naming-convention */
        }
        return s;
    });
}
function shape_period_derivation_deps(raw, view_cadence, window_start_ms, window_end_ms) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6;
    const { budget_entities, monthly_period_docs, outflows, inflows, all_goals } = raw;
    const catalog = raw.category_catalog;
    // Group views tag each bill/income with its member (owner badge); Me stays unchanged.
    const owner_of = (user_id) => (raw.scope.kind === "group" ? { owner_user_id: user_id } : {});
    const out_of_view_recurring_ids = raw.out_of_view_recurring.ids;
    const raw_excluded = raw.fuzzy_excluded_plaid_ids;
    // Converted bills / income (v2 + manual + vendor key + account): D1-linked by the engine.
    const converted_ids = new Set([...outflows, ...inflows].filter((r) => (0, convert_recurring_service_1.is_converted_candidate)(r)).map((r) => r.id));
    const overlapping = overlapping_for_window(raw.overlapping, window_start_ms, window_end_ms);
    // Active, income-drawing goals contribute their planned per-period set-aside to
    // the Everything-Else leftover (EE limit = income − bills − goals − budgets).
    const goals = all_goals
        .filter((g) => g.status === "active" && g.draws_income)
        .map((g) => ({ per_period_amount: g.per_period_amount, home_cadence: g.home_cadence }));
    // Buckets for the requested cadence overlapping the window.
    const view_buckets = overlapping
        .filter((p) => p.period_type === view_cadence)
        .map((p) => ({
        period_id: p.period_id,
        period_type: view_cadence,
        start_ms: p.start_date.toMillis(),
        end_ms: p.end_date.toMillis(),
    }));
    const placement_buckets = view_buckets.map((b) => ({
        period_id: b.period_id,
        start_ms: b.start_ms,
        end_ms: b.end_ms,
    }));
    // Monthly source-period boundaries in the window — used to SYNTHESIZE a
    // budget's allocation from its `amount` when it has no materialized monthly
    // period yet (a brand-new budget), so it shows a limit instantly.
    const monthly_source_periods = overlapping
        .filter((p) => p.period_type === "monthly")
        .map((p) => ({ start_ms: p.start_date.toMillis(), end_ms: p.end_date.toMillis() }));
    const span_start_ms = view_buckets.length
        ? Math.min(...view_buckets.map((b) => b.start_ms))
        : window_start_ms;
    const span_end_ms = view_buckets.length
        ? Math.max(...view_buckets.map((b) => b.end_ms))
        : window_end_ms;
    // 2. Budgets + their monthly homes (fetched above, in parallel).
    const monthly_by_budget = new Map();
    for (const p of monthly_period_docs) {
        if (p.end_date.toMillis() < span_start_ms || p.start_date.toMillis() > span_end_ms) {
            continue;
        }
        const list = (_a = monthly_by_budget.get(p.budget_id)) !== null && _a !== void 0 ? _a : [];
        // "This Period Only" (a per-period amount the user set) replaces the budget's amount here.
        list.push({
            allocated_amount: (_b = p.modified_amount) !== null && _b !== void 0 ? _b : p.allocated_amount,
            // BASE (no adjustments): the page spreads adjustments by their own range, not the month.
            effective_amount: ((_c = p.modified_amount) !== null && _c !== void 0 ? _c : p.allocated_amount) + p.rolled_over_amount,
            adjustments: (_d = p.period_adjustments) !== null && _d !== void 0 ? _d : [],
            start_ms: p.start_date.toMillis(),
            end_ms: p.end_date.toMillis(),
        });
        monthly_by_budget.set(p.budget_id, list);
    }
    // THE budget set (domain/budgets/match_budgets — the same one the assignment engine stores
    // from): a budget is active from the start of its own-cadence period containing its start date
    // (it owns that period's earlier purchases) through `budget_end_date`.
    const match = (0, match_budgets_service_1.build_match_budgets)(budget_entities.map(match_budgets_service_1.budget_to_match_input));
    const real_budgets = match.real_budgets;
    const monthly_ee_id = match.everything_else_ids.monthly;
    const any_ee_id = match.primary_everything_else_id;
    const active_by_id = new Map(real_budgets.map((b) => [b.id, b]));
    const budgets = [];
    for (const b of budget_entities) {
        const is_ee = b.is_system_everything_else === true;
        // EE is always active; a real budget's active range comes from the shared builder.
        const active = active_by_id.get(b.id);
        const active_start_ms = is_ee || !active ? 0 : active.start_ms;
        const active_end_ms = is_ee || !active ? null : active.end_ms;
        // Prefer the materialized monthly periods (they carry per-period edits +
        // rollover). If none exist yet (a brand-new budget), SYNTHESIZE them from
        // the budget's `amount` so the limit shows instantly — no wait for the
        // generation cascade.
        const materialized = (_e = monthly_by_budget.get(b.id)) !== null && _e !== void 0 ? _e : [];
        const monthly_periods = materialized.length > 0
            ? materialized
            : monthly_source_periods.map((sp) => {
                const amt = monthly_equivalent_amount(b.amount, b.period);
                return {
                    allocated_amount: amt,
                    effective_amount: amt,
                    start_ms: sp.start_ms,
                    end_ms: sp.end_ms,
                };
            });
        budgets.push({
            id: b.id,
            name: b.name,
            is_ee,
            monthly_periods,
            active_start_ms,
            active_end_ms,
        });
    }
    // 3. The window's transactions (the per-window query's inclusive date range, re-filtered
    // from the raw load in its original order).
    const in_range = (lo_ms, hi_ms) => (t) => {
        const d = t.data.transactionDate;
        return ts_cmp(d, lo_ms) >= 0 && ts_cmp(d, hi_ms) <= 0;
    };
    const txns = raw.txns.filter(in_range(span_start_ms, span_end_ms));
    // The pairing pool: the span ± the shared pairing slack (as the stored transfer roles pair) —
    // pairs are decided over it, only `txns` (the span) is counted.
    const pool_lo = span_start_ms - edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
    const pool_hi = span_end_ms + edge_transfers_service_1.TRANSFER_PAIRING_BUFFER_MS;
    const view_pool = raw.txns.filter(in_range(pool_lo, pool_hi));
    // 3a. Matched-pair INTERNAL-transfer detection. `TRANSFER_*` alone is ambiguous —
    // Plaid tags both own-account transfers AND external ACH bills (mortgage, subs)
    // as TRANSFER_OUT_ACCOUNT_TRANSFER. A transfer is INTERNAL only when it pairs with
    // an opposite transfer of the same amount on ANOTHER account within a few days;
    // unpaired transfers are EXTERNAL (real spending/bills) and are NOT excluded.
    const { internal_ids, internal_plaid_ids } = (0, on_read_matching_1.detect_internal_transfers_from_txns)(view_pool, catalog);
    // A recurring stream is an internal transfer when any of its transactions are.
    const is_internal_stream = (transaction_ids) => (transaction_ids !== null && transaction_ids !== void 0 ? transaction_ids : []).some((t) => internal_plaid_ids.has(t));
    // 3b. Counting at the edge (Account-Rooted-Sharing D12). Pair transfers across ALL the view's
    // members' accounts too: a transfer that's internal there but NOT inside this view crosses the
    // view boundary → it's EDGE money, counted on its own date: into the view = "Other income",
    // out of it = spending (Everything Else / a budget by category). Bill / income links and
    // recurring-stream membership are ignored for edge money (it isn't a bill or a paycheck), and
    // hidden transfer streams stay hidden. With nothing shared, `crossing` is empty.
    const all_in_pool = raw.all_member_txns.filter(in_range(pool_lo, pool_hi));
    // Two-stage pairing: pairs INSIDE the view win (stage 1, above); only the view's leftover
    // transfers are then paired against the members' other accounts (stage 2), so a cross-view
    // match can never steal one of the view's own pairs.
    const crossing = (0, edge_transfers_service_1.find_crossing_transfers)((0, on_read_matching_1.detect_internal_transfers_from_txns)(all_in_pool.filter((t) => !internal_ids.has(t.id)), catalog), internal_ids, view_pool, (d) => (0, on_read_matching_1.txn_effective_category)(d, catalog));
    const recurring = [];
    const payments_by_id = new Map();
    // Included bills' Plaid `transactionIds` → map built AFTER the loop (conflict-safe).
    // Bill / income id → its remove / pause spans (only items that have any).
    const removal_by_id = new Map();
    // D31: a removed bill's schedule — a LATE payment of its last occurrence isn't released.
    const bill_schedule_by_id = new Map();
    // Lets a bill's payments be attributed DETERMINISTICALLY from Plaid's own stream, not
    // only the sparse `split.outflowId` link — the fix for "paid bills read unpaid".
    const outflow_stream_items = [];
    for (const o of outflows) {
        if (!o.is_active || o.is_hidden)
            continue; // hidden = classified internal transfer
        // Skip only INTERNAL account transfers; external ACH bills (mortgage, etc.) stay. A v2 record
        // is decided by the classifier's majority rule alone (X7) — no on-read any-one check, or one
        // coincidental pair in the window would hide it here while the engine still links it.
        if (o.capture_rules_version !== 2 &&
            (0, budget_spend_service_1.is_transfer_category)(o.plaid_detailed_category) &&
            is_internal_stream(o.transaction_ids)) {
            continue;
        }
        recurring.push(Object.assign({ id: o.id, kind: "outflow", name: o.user_custom_name || o.merchant_name || o.description || "Bill", schedule: {
                frequency: o.frequency,
                // User override ("this + future") wins over Plaid's average when set.
                average_amount: (_f = o.expected_amount_override) !== null && _f !== void 0 ? _f : o.average_amount,
                first_date: o.first_date,
                last_date: o.last_date,
                predicted_next_date: o.predicted_next_date,
                source: o.source,
            }, payments: [], 
            // User remove/pause spans — filtered per period on read (not a blanket skip,
            // so past periods still show a going-forward/paused bill).
            removal_intervals: o.removal_intervals, 
            // "Mark as paid" marks (cash / unlinked-account payments) — applied after reconcile.
            manual_settled_occurrences: o.manual_settled_occurrences }, owner_of(o.user_id)));
        if ((_g = o.removal_intervals) === null || _g === void 0 ? void 0 : _g.length) {
            removal_by_id.set(o.id, o.removal_intervals);
            bill_schedule_by_id.set(o.id, recurring[recurring.length - 1].schedule);
        }
        payments_by_id.set(o.id, []);
        outflow_stream_items.push({ id: o.id, transaction_ids: (_h = o.transaction_ids) !== null && _h !== void 0 ? _h : [] });
    }
    // Income is reconciled DETERMINISTICALLY off Plaid's own stream `transaction_ids`
    // (see Income-Tracking-Audit), not fuzzy merchant matching: map each stream
    // transaction (Plaid id) → its inflow, then attribute payments below. Transfer
    // streams are NOT income — skip them so they never appear as expected income.
    const inflow_stream_items = [];
    for (const i of inflows) {
        if (!i.is_active || i.is_hidden)
            continue; // hidden = classified internal transfer
        // Skip only INTERNAL account transfers; external inbound transfers stay. (v2: classifier only.)
        if (i.capture_rules_version !== 2 &&
            (0, budget_spend_service_1.is_transfer_category)(i.plaid_detailed_category) &&
            is_internal_stream(i.transaction_ids)) {
            continue;
        }
        recurring.push(Object.assign({ id: i.id, kind: "inflow", name: i.user_custom_name || i.payer_name || i.description || "Income", schedule: {
                frequency: i.frequency,
                // User override ("this + future") wins over Plaid's average when set.
                average_amount: (_j = i.expected_amount_override) !== null && _j !== void 0 ? _j : i.average_amount,
                first_date: i.first_date,
                last_date: i.last_date,
                predicted_next_date: i.predicted_next_date,
                source: i.source,
            }, payments: [], 
            // When set, the override wins over per-slot auto-estimates in derive_period.
            has_amount_override: i.expected_amount_override != null, 
            // Per-occurrence expected overrides (keyed by due-date) — win over everything for that occ.
            occurrence_amount_overrides: i.occurrence_amount_overrides, 
            // Income remove/pause spans — filtered per period on read, same as bills.
            removal_intervals: i.removal_intervals, 
            // "Mark as received" marks (income received outside linked accounts).
            manual_settled_occurrences: i.manual_settled_occurrences }, owner_of(i.user_id)));
        if ((_k = i.removal_intervals) === null || _k === void 0 ? void 0 : _k.length)
            removal_by_id.set(i.id, i.removal_intervals);
        payments_by_id.set(i.id, []);
        inflow_stream_items.push({ id: i.id, transaction_ids: (_l = i.transaction_ids) !== null && _l !== void 0 ? _l : [] });
    }
    // Authoritative bill/income links from Plaid stream `transactionIds`. A txn claimed by
    // TWO streams is EXCLUDED (no arbitrary guess — see build_stream_membership_map).
    const outflow_tx_to_id = (0, stream_membership_1.build_stream_membership_map)(outflow_stream_items);
    const inflow_tx_to_id = (0, stream_membership_1.build_stream_membership_map)(inflow_stream_items);
    // The bills / income removed or paused for a payment's month (usually none).
    // D31: a bill's late payment of its last occurrence before the cut-off is not released (the
    // engine stores the same — is_payment_released).
    // D37: a removed bill's payments (every transaction loaded, incl. the lookback) — the release
    // rule keeps a late payment only while the occurrence it pays is still unpaid by them.
    const bill_payments_by_id = new Map();
    if (bill_schedule_by_id.size > 0) {
        const seen_txn = new Set();
        for (const { id, data } of [...((_m = raw.release_lookback_txns) !== null && _m !== void 0 ? _m : []), ...raw.txns]) {
            if (seen_txn.has(id))
                continue;
            seen_txn.add(id);
            const plaid_txn_id = (_o = data.transactionId) !== null && _o !== void 0 ? _o : null;
            const stored_splits = (_p = data.splits) !== null && _p !== void 0 ? _p : [];
            const splits = (plaid_txn_id && (raw_excluded === null || raw_excluded === void 0 ? void 0 : raw_excluded.has(plaid_txn_id)) ? without_guessed_links(stored_splits, converted_ids) : stored_splits)
                .filter((sp) => !(0, stream_membership_1.is_manual_period_pin)(sp));
            const stream_bill = plaid_txn_id ? outflow_tx_to_id.get(plaid_txn_id) : undefined;
            for (const rid of bill_schedule_by_id.keys()) {
                const linked = splits.filter((sp) => sp.outflowId === rid);
                const paying = linked.length
                    ? linked
                    : stream_bill === rid ? (0, stream_membership_1.splits_paying_recurring)(splits, "outflow", rid, true) : [];
                if (paying.length === 0)
                    continue;
                const list = (_q = bill_payments_by_id.get(rid)) !== null && _q !== void 0 ? _q : [];
                list.push({
                    id,
                    date_ms: data.transactionDate.toMillis(),
                    amount: (0, period_reconciliation_service_1.compute_countable_split_net)(paying, id).amount,
                });
                bill_payments_by_id.set(rid, list);
            }
        }
    }
    const released_at = (txn_date_ms, txn_id) => {
        var _a;
        const ids = new Set();
        for (const [rid, intervals] of removal_by_id) {
            const schedule = bill_schedule_by_id.get(rid);
            const bill = schedule ? { schedule, payments: (_a = bill_payments_by_id.get(rid)) !== null && _a !== void 0 ? _a : [] } : null;
            if ((0, late_payment_service_1.is_payment_released)(intervals, { id: txn_id, date_ms: txn_date_ms }, bill))
                ids.add(rid);
        }
        return ids;
    };
    // 4. ONE pass over the window's transactions → split-match inputs + per-item payments.
    const splits_for_match = [];
    // Real INCOME_* credits in the window NOT tied to any recurring inflow → "Other income
    // received" (off-cycle paychecks, bonuses, contractor/gig), so real income is never hidden.
    const other_income_credits = [];
    // A bill payment PINNED to a period (outflowPinnedPeriodId — the two-stage bill picker) is
    // placed at that period's midpoint, exactly as reconcile places it: it pays THAT period, not
    // the one its date falls in.
    const period_range = new Map(raw.overlapping.map((p) => [p.id, { start_ms: p.start_date.toMillis(), end_ms: p.end_date.toMillis() }]));
    /** The pinned period's range; `undefined` = not pinned; `null` = pinned to a period this
     *  derive didn't load (outside its windows) — it pays THAT period, never one here. */
    const pinned_period = (linked, link) => {
        var _a;
        const pin = linked.find((sp) => sp.outflowId === link && (0, stream_membership_1.is_manual_period_pin)(sp));
        if (!pin)
            return undefined;
        return (_a = period_range.get(pin.outflowPinnedPeriodId)) !== null && _a !== void 0 ? _a : null;
    };
    const mid = (r) => Math.floor((r.start_ms + r.end_ms) / 2);
    // A payment whose NET is nothing (all its splits Ignored) or negative (a refund) isn't recorded
    // as a payment — stored reconcile only counts a paid amount above zero, so the page must not
    // mark an occurrence paid / received with it.
    const PAYMENT_EPSILON = 0.005;
    const push_payment = (link, p) => {
        if (p.amount > PAYMENT_EPSILON)
            payments_by_id.get(link).push(p);
    };
    for (const { id, data } of txns) {
        const txn_date_ms = data.transactionDate.toMillis();
        const is_pending = data.isPending === true;
        // Only INTERNAL (matched-pair) transfers are excluded from spend; external ACH
        // payments keep counting.
        const txn_is_internal_transfer = internal_ids.has(id);
        const txn_is_income = data.type === "income";
        // Edge money (D12, see 3b): crosses the view boundary.
        const is_edge = crossing.ids.has(id);
        // Is this transaction part of a Plaid income stream? (Plaid id → inflow.) Per SPLIT, a
        // budget pin takes that split off it (canon A4) — see `is_split_on_stream` below.
        const plaid_txn_id = (_r = data.transactionId) !== null && _r !== void 0 ? _r : null;
        // A bill / income removed or paused for this payment's month isn't paid by it: the money
        // counts as ordinary spending / money in (the engine stores the same — is_payment_released).
        const released = released_at(txn_date_ms, id);
        const live = (rid) => rid && !released.has(rid) ? rid : undefined;
        const linked_inflow_id = plaid_txn_id && !is_edge ? live(inflow_tx_to_id.get(plaid_txn_id)) : undefined;
        // A split linked to a bill / income that lives in ANOTHER view (its account isn't in this
        // one) isn't this view's bill payment: drop the link so the money counts here as ordinary
        // spending / money in, instead of vanishing (Account-Rooted-Sharing). No-op for Me with
        // nothing shared. Edge money drops every link.
        const stored_splits = (_s = data.splits) !== null && _s !== void 0 ? _s : [];
        const raw = is_edge
            ? without_recurring_links(stored_splits)
            : without_out_of_view_links(plaid_txn_id && (raw_excluded === null || raw_excluded === void 0 ? void 0 : raw_excluded.has(plaid_txn_id))
                ? without_guessed_links(stored_splits, converted_ids)
                : stored_splits, released.size
                ? new Set([...out_of_view_recurring_ids, ...released])
                : out_of_view_recurring_ids);
        // Plaid bill stream membership. Per SPLIT, a manual "remove from bill" or a budget pin takes
        // that split off it: it's neither a bill payment nor excluded from budget spend as a
        // recurring member — the transaction's other splits stay on the bill.
        const linked_outflow_id = plaid_txn_id && !is_edge ? live(outflow_tx_to_id.get(plaid_txn_id)) : undefined;
        const on_outflow_stream = (sp) => !!linked_outflow_id && (0, stream_membership_1.is_split_on_stream)(sp, "outflow");
        const on_inflow_stream = (sp) => !!linked_inflow_id && (0, stream_membership_1.is_split_on_stream)(sp, "inflow", linked_inflow_id);
        // "Other income received", per split: an INCOME-meaning split (its EFFECTIVE category — a
        // user's pick decides, canon M7) not on an income stream, not linked to an income, and not
        // pinned to a budget (a pinned income credit counts in that budget — canon A13).
        let other_income_amount = 0;
        const linked_by_id = new Map();
        for (const s of raw) {
            const outflow_id = (_t = s.outflowId) !== null && _t !== void 0 ? _t : null;
            const inflow_id = (_u = s.inflowId) !== null && _u !== void 0 ? _u : null;
            const amount = (_v = s.amount) !== null && _v !== void 0 ? _v : 0;
            // Excluded from spend only when it's an INTERNAL account transfer (matched
            // pair). External ACH payments tagged TRANSFER_* stay countable.
            splits_for_match.push((0, on_read_matching_1.map_raw_split_to_on_read_match)(s, {
                txn_date_ms,
                is_pending,
                is_transfer: txn_is_internal_transfer,
                is_income: txn_is_income,
                // Txn belongs to a recurring bill/income Plaid stream → not discretionary spend,
                // so it never counts toward a budget even if its split link was never set (S5).
                is_recurring_member: on_outflow_stream(s) || on_inflow_stream(s),
                merchant_name: (_w = data.merchantName) !== null && _w !== void 0 ? _w : null,
                name: (_x = data.name) !== null && _x !== void 0 ? _x : null,
            }, catalog));
            const matched = splits_for_match[splits_for_match.length - 1];
            if (is_edge && crossing.out_ids.has(id)) {
                matched.is_edge_out = true;
            }
            if ((0, stream_membership_1.is_other_income_split)(s, matched.semantic_code, on_inflow_stream(s), txn_is_income)) {
                other_income_amount += Math.abs(amount);
            }
            else if (crossing.in_ids.has(id) &&
                s.budgetAssignmentSource !== "manual" &&
                (0, budget_spend_service_1.split_spend_status)(s) !== "ignored" &&
                (0, budget_spend_service_1.is_transfer_category)(matched.semantic_code)) {
                // D12: money moved INTO this view from a member's account outside it (e.g. a share sent
                // to the joint account) is income for this view, on the day it arrived — per split: a
                // split re-categorized to spending / pinned counts in that budget instead, never both.
                other_income_amount += Math.abs(amount);
            }
            // Outflow (bills) attribute via the split's stored link; MANUAL inflows via
            // split.inflowId — but a Plaid income txn is attributed ONCE below via
            // transaction_ids (skip its split link here to avoid double-counting).
            // A manual income pin (Phase 2) to an income OTHER than the stream's wins and pays it once;
            // a pin to the stream's own income is counted by the stream pass below, not twice.
            const manual_inflow_pin = s.inflowAssignmentSource === "manual" && !!inflow_id && inflow_id !== linked_inflow_id;
            const link = outflow_id !== null && outflow_id !== void 0 ? outflow_id : (manual_inflow_pin ? inflow_id : linked_inflow_id ? null : inflow_id);
            if (link && payments_by_id.has(link)) {
                linked_by_id.set(link, [...((_y = linked_by_id.get(link)) !== null && _y !== void 0 ? _y : []), s]);
            }
        }
        // ONE payment per (transaction, bill / income), its NET countable amount — exactly as
        // reconcile counts it (`compute_countable_split_net`: an Ignored split adds nothing, a Refund
        // split subtracts) — so the page and the stored paid status agree.
        const net = (xs) => (0, period_reconciliation_service_1.compute_countable_split_net)(xs, id);
        for (const [link, linked] of linked_by_id) {
            const pinned = pinned_period(linked, link);
            // Pinned to a period this derive didn't load: it pays THAT period, never one here.
            if (pinned === null)
                continue;
            const n = net(linked);
            // A pinned payment carries its FULL pinned period; the period view places it on that
            // period's first due occurrence (stored reconcile's rule) and counts it only in the span
            // containing that due date (domain/periods/period_view `resolve_pinned_payments`).
            push_payment(link, Object.assign({ transaction_id: id, split_id: n.split_id, date_ms: pinned ? mid(pinned) : txn_date_ms, amount: n.amount }, (pinned ? { pinned_window: pinned } : {})));
        }
        // Deterministic Plaid income reconciliation: this txn belongs to an inflow
        // stream → it's a received payment for that inflow (its full deposit amount).
        const inflow_on = raw.filter(on_inflow_stream);
        if (linked_inflow_id && inflow_on.length && payments_by_id.has(linked_inflow_id)) {
            push_payment(linked_inflow_id, {
                transaction_id: id,
                split_id: null,
                date_ms: txn_date_ms,
                amount: net(inflow_on).amount, // the splits still on the stream (all, unless some pinned)
            });
        }
        // Deterministic Plaid BILL reconciliation (mirror of income): this txn belongs to
        // an outflow's recurring stream → it's a payment for that bill. Only when NO split
        // already links this txn to a bill (the split link is precise + wins), so we never
        // double-count. Covers historical/unlinked payments whose `split.outflowId` was
        // never set — the root cause of paid bills reading unpaid on read.
        // Same rule as reconcile (`splits_paying_recurring`): splits linked to THIS bill paid it in
        // the split-link pass above; with none, the stream's unlinked, not-taken-off splits pay it.
        if (linked_outflow_id && payments_by_id.has(linked_outflow_id)) {
            const linked_here = raw.some((sp) => { var _a; return ((_a = sp.outflowId) !== null && _a !== void 0 ? _a : null) === linked_outflow_id; });
            const stream_paying = linked_here
                ? []
                : (0, stream_membership_1.splits_paying_recurring)(raw, "outflow", linked_outflow_id, true);
            if (stream_paying.length) {
                push_payment(linked_outflow_id, {
                    transaction_id: id,
                    split_id: null,
                    date_ms: txn_date_ms,
                    amount: net(stream_paying).amount,
                });
            }
        }
        // "Other income received" (accumulated per split above: income-meaning credits + edge-in
        // transfer money). An income category naturally excludes internal transfers + most refunds.
        if (other_income_amount > 0 && !txn_is_internal_transfer) {
            other_income_credits.push({ date_ms: txn_date_ms, amount: other_income_amount });
        }
    }
    // Payments dated OUTSIDE the span but PINNED to a period in it pay that period here (reconcile
    // counts them there too): the pairing pool (± a few days), plus the payments of bills with a period
    // pinned among the loaded ones, dated anywhere (a late payment of an overdue month).
    const counted_ids = new Set(txns.map((t) => t.id));
    const pool_ids = new Set(view_pool.map((t) => t.id));
    const pinned_elsewhere = ((_z = raw.pinned_bill_txns) !== null && _z !== void 0 ? _z : []).filter(
    // Not already in the span / pool; edge money pays nothing (as stored reconcile drops it).
    (t) => !counted_ids.has(t.id) && !pool_ids.has(t.id) && !(0, stream_membership_1.is_edge_money)(t.data.transferRole));
    for (const { id, data } of [...view_pool, ...pinned_elsewhere]) {
        if (counted_ids.has(id) || crossing.ids.has(id))
            continue;
        // Released bills (removed / paused for this payment's month) are dropped here too.
        const pool_released = released_at(data.transactionDate.toMillis(), id);
        // Every split linked to a bill, so a pinned payment's amount is the net of ALL its splits on that
        // bill — as the in-span pass and stored reconcile count it (one payment, placed by the pin).
        const linked_splits = without_out_of_view_links((_0 = data.splits) !== null && _0 !== void 0 ? _0 : [], pool_released.size
            ? new Set([...out_of_view_recurring_ids, ...pool_released])
            : out_of_view_recurring_ids).filter((sp) => sp.outflowId);
        const by_link = new Map();
        for (const sp of linked_splits) {
            const link = sp.outflowId;
            if (payments_by_id.has(link))
                by_link.set(link, [...((_1 = by_link.get(link)) !== null && _1 !== void 0 ? _1 : []), sp]);
        }
        for (const [link, linked] of by_link) {
            const pinned = pinned_period(linked, link);
            if (!pinned)
                continue; // not pinned (counted by date in its own view), or pinned outside this load
            const n = (0, period_reconciliation_service_1.compute_countable_split_net)(linked, id);
            push_payment(link, {
                pinned_window: pinned, // the period view keeps it only in the span of its due occurrence
                transaction_id: id,
                split_id: n.split_id,
                date_ms: mid(pinned),
                amount: n.amount,
            });
        }
    }
    // D31: a removed / paused / ended bill's LATE payment of its last occurrence (due Sep 29, paid
    // Oct 2, removed from Oct 1) is dated just after the span but pays that occurrence here — the
    // matcher pairs it (the Oct view counts it nowhere: nothing it pays is in Oct). Only payments
    // the release rule keeps (late payments) of bills with a removal; pinned ones are placed above.
    if (bill_schedule_by_id.size > 0) {
        const late_end = span_end_ms + late_payment_service_1.LATE_PAYMENT_MAX_MS;
        for (const { id, data } of raw.txns) {
            const txn_date_ms = data.transactionDate.toMillis();
            if (txn_date_ms <= span_end_ms || txn_date_ms > late_end || counted_ids.has(id) || crossing.ids.has(id))
                continue;
            const released = released_at(txn_date_ms, id);
            // D37: only a payment made in a SUPPRESSED month of that bill (a late payment the release
            // rule keeps) — a payment in a kept month past the span is no different from a never-removed
            // bill's (the next view counts it), so a live bill with a past pause doesn't reach for it.
            const kept = [...bill_schedule_by_id.keys()].filter((rid) => !released.has(rid) && (0, recurring_suppression_service_1.is_payment_suppressed)(removal_by_id.get(rid), txn_date_ms));
            if (kept.length === 0)
                continue;
            const plaid_txn_id = (_2 = data.transactionId) !== null && _2 !== void 0 ? _2 : null;
            const stored_splits = (_3 = data.splits) !== null && _3 !== void 0 ? _3 : [];
            const splits = without_out_of_view_links(plaid_txn_id && (raw_excluded === null || raw_excluded === void 0 ? void 0 : raw_excluded.has(plaid_txn_id)) ? without_guessed_links(stored_splits, converted_ids) : stored_splits, released.size ? new Set([...out_of_view_recurring_ids, ...released]) : out_of_view_recurring_ids);
            // A bill this payment pays through a PIN is placed by the pin (above / in another view) —
            // never also here by date, not even its unpinned splits.
            const pinned_to = new Set(splits.filter(stream_membership_1.is_manual_period_pin).map((sp) => sp.outflowId));
            const unpinned = splits.filter((sp) => !(0, stream_membership_1.is_manual_period_pin)(sp));
            const stream_bill = plaid_txn_id ? outflow_tx_to_id.get(plaid_txn_id) : undefined;
            for (const rid of kept) {
                if (pinned_to.has(rid))
                    continue;
                const linked = unpinned.filter((sp) => sp.outflowId === rid);
                const paying = linked.length
                    ? linked
                    : stream_bill === rid ? (0, stream_membership_1.splits_paying_recurring)(unpinned, "outflow", rid, true) : [];
                if (paying.length === 0)
                    continue;
                const n = (0, period_reconciliation_service_1.compute_countable_split_net)(paying, id);
                push_payment(rid, { transaction_id: id, split_id: linked.length ? n.split_id : null, date_ms: txn_date_ms, amount: n.amount });
            }
        }
    }
    for (const r of recurring) {
        r.payments = (_4 = payments_by_id.get(r.id)) !== null && _4 !== void 0 ? _4 : [];
    }
    // INCOME per-slot amounts: each inflow's HISTORICAL linked deposits (its whole Plaid stream,
    // not just the in-window ones) so a semi-monthly stream's mid vs end occurrences can each show
    // their own slot's recent average instead of the blended stream average. The docs were loaded
    // (for a superset of stream ids) in `load_period_derivation_raw`; attribute them via this
    // window's membership map exactly as the per-window query did.
    if (inflow_tx_to_id.size > 0) {
        const history_by_inflow = new Map();
        for (const d of raw.inflow_history_docs) {
            // A removed account's / superseded pending's deposit isn't real income — not in the estimate.
            const deposit = (0, income_slot_amounts_1.history_doc_to_deposit)(d);
            if (!deposit)
                continue;
            const inflow_id = inflow_tx_to_id.get(d.transactionId);
            if (!inflow_id)
                continue;
            const list = (_5 = history_by_inflow.get(inflow_id)) !== null && _5 !== void 0 ? _5 : [];
            list.push(deposit);
            history_by_inflow.set(inflow_id, list);
        }
        for (const r of recurring) {
            if (r.kind === "inflow")
                r.payment_history = (_6 = history_by_inflow.get(r.id)) !== null && _6 !== void 0 ? _6 : [];
        }
    }
    // Emit only ONE Everything-Else budget (the monthly home). Today's data has a
    // per-cadence EE (monthly/weekly/bi_monthly) that each derive the same
    // unmatched total on read — showing all three is redundant. Keep the monthly
    // EE (fall back to any EE).
    const canonical_ee_id = monthly_ee_id !== null && monthly_ee_id !== void 0 ? monthly_ee_id : any_ee_id;
    const budgets_out = budgets.filter((b) => !b.is_ee || b.id === canonical_ee_id);
    return {
        view_buckets,
        placement_buckets,
        budgets: budgets_out,
        real_budgets,
        monthly_ee_id,
        any_ee_id,
        ee_alias_ids: match.everything_else_id_set,
        splits_for_match,
        recurring,
        goals,
        other_income_credits,
        span_start_ms,
        span_end_ms,
    };
}
/**
 * Load + shape for a SINGLE window — the `derive_period` path. Identical output to deriving any
 * window of a multi-window load (see `derive_period_range`).
 */
async function resolve_period_derivation_deps(ctx, user_id, view_cadence, window_start_ms, window_end_ms, scope_request) {
    const raw = await load_period_derivation_raw(ctx, user_id, view_cadence, [{ start_ms: window_start_ms, end_ms: window_end_ms }], scope_request);
    return shape_period_derivation_deps(raw, view_cadence, window_start_ms, window_end_ms);
}
//# sourceMappingURL=period_derivation.resolver.js.map