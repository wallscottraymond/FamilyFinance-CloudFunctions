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
exports.resolve_period_derivation_deps = resolve_period_derivation_deps;
const firestore_1 = require("firebase-admin/firestore");
const repositories_1 = require("../../repositories");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_spend_service_1 = require("../../domain/budgets/budget_spend.service");
const internal_transfer_service_1 = require("../../domain/transactions/internal_transfer.service");
function to_cadence(period) {
    return period === "weekly" ? "weekly" : period === "bi_monthly" ? "bi_monthly" : "monthly";
}
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
async function resolve_period_derivation_deps(ctx, user_id, view_cadence, window_start_ms, window_end_ms) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    // 1. Buckets for the requested cadence overlapping the window.
    const overlapping = await repositories_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(window_start_ms), firestore_1.Timestamp.fromMillis(window_end_ms));
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
    // 2. Budgets + their monthly homes (one query each).
    const budget_entities = await repositories_1.budget_repo.get_by_user_id(ctx, user_id);
    const monthly_period_docs = await budget_period_repo_1.budget_period_repo.get_by_user_and_type(ctx, user_id, "monthly");
    const monthly_by_budget = new Map();
    for (const p of monthly_period_docs) {
        if (p.end_date.toMillis() < span_start_ms || p.start_date.toMillis() > span_end_ms) {
            continue;
        }
        const list = (_a = monthly_by_budget.get(p.budget_id)) !== null && _a !== void 0 ? _a : [];
        list.push({
            allocated_amount: p.allocated_amount,
            effective_amount: p.effective_amount,
            start_ms: p.start_date.toMillis(),
            end_ms: p.end_date.toMillis(),
        });
        monthly_by_budget.set(p.budget_id, list);
    }
    const real_budgets = [];
    const budgets = [];
    let monthly_ee_id = null;
    let any_ee_id = null;
    for (const b of budget_entities) {
        const is_ee = b.is_system_everything_else === true;
        if (is_ee) {
            any_ee_id = any_ee_id !== null && any_ee_id !== void 0 ? any_ee_id : b.id;
            if (b.period === "monthly")
                monthly_ee_id = b.id;
        }
        else {
            real_budgets.push({
                id: b.id,
                category_ids: b.category_ids,
                start_ms: b.start_date.toMillis(),
                end_ms: b.is_ongoing ? null : b.end_date.toMillis(),
                is_ongoing: b.is_ongoing,
                cadence: to_cadence(b.period),
            });
        }
        // Prefer the materialized monthly periods (they carry per-period edits +
        // rollover). If none exist yet (a brand-new budget), SYNTHESIZE them from
        // the budget's `amount` so the limit shows instantly — no wait for the
        // generation cascade.
        const materialized = (_b = monthly_by_budget.get(b.id)) !== null && _b !== void 0 ? _b : [];
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
        budgets.push({ id: b.id, name: b.name, is_ee, monthly_periods });
    }
    // 3. Load recurring schedules + the window's transactions together.
    const [outflows, inflows, txns] = await Promise.all([
        repositories_1.outflow_repo.get_by_user_id(ctx, user_id),
        repositories_1.inflow_repo.get_by_user_id(ctx, user_id),
        transaction_repo_1.transaction_repo.get_active_in_date_range(ctx, user_id, span_start_ms, span_end_ms),
    ]);
    // 3a. Matched-pair INTERNAL-transfer detection. `TRANSFER_*` alone is ambiguous —
    // Plaid tags both own-account transfers AND external ACH bills (mortgage, subs)
    // as TRANSFER_OUT_ACCOUNT_TRANSFER. A transfer is INTERNAL only when it pairs with
    // an opposite transfer of the same amount on ANOTHER account within a few days;
    // unpaired transfers are EXTERNAL (real spending/bills) and are NOT excluded.
    const transfers_for_pairing = [];
    for (const { id, data } of txns) {
        const raw0 = (_c = data.splits) !== null && _c !== void 0 ? _c : [];
        const first = (_d = raw0[0]) !== null && _d !== void 0 ? _d : {};
        const eff = (_f = (_e = first.internalDetailedCategory) !== null && _e !== void 0 ? _e : first.plaidDetailedCategory) !== null && _f !== void 0 ? _f : "";
        if (!(0, budget_spend_service_1.is_transfer_category)(eff))
            continue;
        transfers_for_pairing.push({
            id,
            plaid_id: (_g = data.transactionId) !== null && _g !== void 0 ? _g : null,
            account_id: (_h = data.accountId) !== null && _h !== void 0 ? _h : "",
            amount: raw0.reduce((s, sp) => { var _a; return s + Math.abs((_a = sp.amount) !== null && _a !== void 0 ? _a : 0); }, 0),
            date_ms: data.transactionDate.toMillis(),
            direction: eff.startsWith("TRANSFER_IN") ? "in" : "out",
        });
    }
    const { internal_ids, internal_plaid_ids } = (0, internal_transfer_service_1.detect_internal_transfers)(transfers_for_pairing);
    // A recurring stream is an internal transfer when any of its transactions are.
    const is_internal_stream = (transaction_ids) => (transaction_ids !== null && transaction_ids !== void 0 ? transaction_ids : []).some((t) => internal_plaid_ids.has(t));
    const recurring = [];
    const payments_by_id = new Map();
    for (const o of outflows) {
        if (!o.is_active || o.is_hidden)
            continue; // hidden = classified internal transfer
        // Skip only INTERNAL account transfers; external ACH bills (mortgage, etc.) stay.
        if ((0, budget_spend_service_1.is_transfer_category)(o.plaid_detailed_category) && is_internal_stream(o.transaction_ids)) {
            continue;
        }
        recurring.push({
            id: o.id,
            kind: "outflow",
            name: o.user_custom_name || o.merchant_name || o.description || "Bill",
            schedule: {
                frequency: o.frequency,
                average_amount: o.average_amount,
                first_date: o.first_date,
                last_date: o.last_date,
                predicted_next_date: o.predicted_next_date,
            },
            payments: [],
        });
        payments_by_id.set(o.id, []);
    }
    // Income is reconciled DETERMINISTICALLY off Plaid's own stream `transaction_ids`
    // (see Income-Tracking-Audit), not fuzzy merchant matching: map each stream
    // transaction (Plaid id) → its inflow, then attribute payments below. Transfer
    // streams are NOT income — skip them so they never appear as expected income.
    const inflow_tx_to_id = new Map();
    for (const i of inflows) {
        if (!i.is_active || i.is_hidden)
            continue; // hidden = classified internal transfer
        // Skip only INTERNAL account transfers; external inbound transfers stay.
        if ((0, budget_spend_service_1.is_transfer_category)(i.plaid_detailed_category) && is_internal_stream(i.transaction_ids)) {
            continue;
        }
        recurring.push({
            id: i.id,
            kind: "inflow",
            name: i.user_custom_name || i.payer_name || i.description || "Income",
            schedule: {
                frequency: i.frequency,
                average_amount: i.average_amount,
                first_date: i.first_date,
                last_date: i.last_date,
                predicted_next_date: i.predicted_next_date,
            },
            payments: [],
        });
        payments_by_id.set(i.id, []);
        for (const tx_id of (_j = i.transaction_ids) !== null && _j !== void 0 ? _j : []) {
            inflow_tx_to_id.set(tx_id, i.id);
        }
    }
    // 4. ONE pass over the window's transactions → split-match inputs + per-item payments.
    const splits_for_match = [];
    for (const { id, data } of txns) {
        const txn_date_ms = data.transactionDate.toMillis();
        const is_pending = data.isPending === true;
        // Only INTERNAL (matched-pair) transfers are excluded from spend; external ACH
        // payments keep counting.
        const txn_is_internal_transfer = internal_ids.has(id);
        const txn_is_income = data.type === "income";
        // Is this transaction part of a Plaid income stream? (Plaid id → inflow.)
        const plaid_txn_id = (_k = data.transactionId) !== null && _k !== void 0 ? _k : null;
        const linked_inflow_id = plaid_txn_id ? inflow_tx_to_id.get(plaid_txn_id) : undefined;
        let income_amount = 0;
        const raw = (_l = data.splits) !== null && _l !== void 0 ? _l : [];
        for (const s of raw) {
            const outflow_id = (_m = s.outflowId) !== null && _m !== void 0 ? _m : null;
            const inflow_id = (_o = s.inflowId) !== null && _o !== void 0 ? _o : null;
            const amount = (_p = s.amount) !== null && _p !== void 0 ? _p : 0;
            const split_id = (_r = (_q = s.splitId) !== null && _q !== void 0 ? _q : s.id) !== null && _r !== void 0 ? _r : null;
            const internal_category = (_s = s.internalDetailedCategory) !== null && _s !== void 0 ? _s : null;
            const plaid_category = (_t = s.plaidDetailedCategory) !== null && _t !== void 0 ? _t : "OTHER_EXPENSE";
            splits_for_match.push({
                amount,
                txn_date_ms,
                is_pending,
                // Excluded from spend only when it's an INTERNAL account transfer (matched
                // pair). External ACH payments tagged TRANSFER_* stay countable.
                is_transfer: txn_is_internal_transfer,
                is_income: txn_is_income,
                spend_status: (_u = s.spendStatus) !== null && _u !== void 0 ? _u : (s.isIgnored === true ? "ignored" : s.isRefund === true ? "refund" : "counted"),
                outflow_id,
                inflow_id,
                internal_match_category: internal_category,
                plaid_match_category: plaid_category,
                overall_category_id: (_v = s.overallCategoryId) !== null && _v !== void 0 ? _v : null,
                first_category_id: (_w = s.firstCategoryId) !== null && _w !== void 0 ? _w : null,
                manual_pin_budget_id: s.budgetAssignmentSource === "manual" ? (_x = s.budgetId) !== null && _x !== void 0 ? _x : null : null,
            });
            income_amount += Math.abs(amount);
            // Outflow (bills) attribute via the split's stored link; MANUAL inflows via
            // split.inflowId — but a Plaid income txn is attributed ONCE below via
            // transaction_ids (skip its split link here to avoid double-counting).
            const link = outflow_id !== null && outflow_id !== void 0 ? outflow_id : (linked_inflow_id ? null : inflow_id);
            if (link && payments_by_id.has(link)) {
                payments_by_id.get(link).push({
                    transaction_id: id,
                    split_id,
                    date_ms: txn_date_ms,
                    amount: Math.abs(amount),
                });
            }
        }
        // Deterministic Plaid income reconciliation: this txn belongs to an inflow
        // stream → it's a received payment for that inflow (its full deposit amount).
        if (linked_inflow_id && payments_by_id.has(linked_inflow_id)) {
            payments_by_id.get(linked_inflow_id).push({
                transaction_id: id,
                split_id: null,
                date_ms: txn_date_ms,
                amount: income_amount,
            });
        }
    }
    for (const r of recurring) {
        r.payments = (_y = payments_by_id.get(r.id)) !== null && _y !== void 0 ? _y : [];
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
        splits_for_match,
        recurring,
        span_start_ms,
        span_end_ms,
    };
}
//# sourceMappingURL=period_derivation.resolver.js.map