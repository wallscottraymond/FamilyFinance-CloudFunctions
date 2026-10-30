"use strict";
/**
 * Compute Transaction Assignment Domain Service
 *
 * The PURE heart of the Transaction Assignment Engine: given a transaction's
 * splits + the resolved context, sequence the matchers through the precedence
 * and return the new per-split assignment, the set of budgets touched
 * (before ∪ after — for the scoped fan-out), and whether anything changed
 * (for skip-if-unchanged).
 *
 * Precedence per split:  category → manual? → recurring → budget → source periods
 *
 * The recurring matchers (outflow/inflow) are owned by Recurring-Period-
 * Reconciliation; their per-split result is INJECTED via the context, so this
 * service stays pure and complete without them.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/compute_transaction_assignment
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERIOD_LENSES = void 0;
exports.compute_transaction_assignment = compute_transaction_assignment;
const match_budget_service_1 = require("./match_budget.service");
/** The three period lenses, in a stable order. */
exports.PERIOD_LENSES = ["monthly", "weekly", "bi_monthly"];
const category_semantics_service_1 = require("./category_semantics.service");
const split_category_service_1 = require("./split_category.service");
const match_source_periods_service_1 = require("./match_source_periods.service");
/**
 * Assemble the assignment for all of a transaction's splits.
 *
 * PURE FUNCTION.
 */
function compute_transaction_assignment(splits, context) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    // Source periods are transaction-level (one date) → compute once.
    const periods = (0, match_source_periods_service_1.match_source_periods)(context.txn_date_ms, context.source_periods);
    const assigned = [];
    const touched = new Set();
    const touched_outflow = new Set();
    const touched_inflow = new Set();
    let changed = false;
    let any_unassigned = false;
    for (const split of splits) {
        // Before-state: prior per-lens assignments (fall back to the legacy monthly
        // `budget_id` for pre-migration docs). Union of before ∪ after = fan-out scope.
        const before_monthly = (_a = split.monthly_budget_id) !== null && _a !== void 0 ? _a : split.budget_id;
        const before_weekly = (_b = split.weekly_budget_id) !== null && _b !== void 0 ? _b : split.budget_id;
        const before_bi_weekly = (_c = split.bi_weekly_budget_id) !== null && _c !== void 0 ? _c : split.budget_id;
        touched.add(before_monthly);
        touched.add(before_weekly);
        touched.add(before_bi_weekly);
        if (split.outflow_id)
            touched_outflow.add(split.outflow_id); // before
        if (split.inflow_id)
            touched_inflow.add(split.inflow_id); // before
        // --- Category: the ONE category function (canon M7) — user / rule pick → merchant &
        // keyword rules → Plaid code → collection → Other. Its `match_keys` drive budget matching
        // (a user pick never ranks the original Plaid code) and `semantic_code` gives it its
        // income / transfer meaning.
        const category = (0, split_category_service_1.resolve_split_category)({
            plaid_detailed: split.plaid_match_category,
            category_source: (_d = split.category_source) !== null && _d !== void 0 ? _d : "plaid",
            first_category_id: (_e = split.first_category_id) !== null && _e !== void 0 ? _e : null,
            overall_category_id: (_f = split.overall_category_id) !== null && _f !== void 0 ? _f : null,
            second_category_id: (_g = split.second_category_id) !== null && _g !== void 0 ? _g : null,
            merchant_name: context.txn_merchant_name,
            name: context.txn_name,
        }, context.category_catalog);
        // A stored user pick the function can't read (no slug at all) is never demoted to Plaid —
        // its fields are kept as stored; matching falls back to Plaid's category meanwhile.
        const keep_stored = split.category_source === "user" && category.category_source !== "user";
        const overall_category_id = keep_stored
            ? (_h = split.overall_category_id) !== null && _h !== void 0 ? _h : null
            : category.overall_category_id;
        const first_category_id = keep_stored
            ? (_j = split.first_category_id) !== null && _j !== void 0 ? _j : null
            : category.first_category_id;
        const second_category_id = keep_stored
            ? (_k = split.second_category_id) !== null && _k !== void 0 ? _k : null
            : category.second_category_id;
        const category_source = keep_stored ? "user" : category.category_source;
        // A Plaid account-transfer split (TRANSFER_IN/OUT) is money moving between accounts, not
        // spending — it never auto-assigns to a budget (mirrors the income B1 rule), EXCEPT money
        // leaving the view (an "edge_out" transfer, 3d): the period page counts that as spending, so
        // it's assigned by category like any purchase. A user pick of a non-transfer category makes
        // it spending.
        const is_transfer = (0, category_semantics_service_1.is_transfer_category)(category.semantic_code) && context.txn_transfer_role !== "edge_out";
        // Income stays out of budgets (B1) — decided by the CATEGORY, as the period page decides it:
        // an income-category split never counts (either direction), while a CREDIT in a spending
        // category is a refund / return the page nets against that category's budget — so it's
        // assigned by category like the purchase it reverses (canon A8, A11).
        const is_income = (0, category_semantics_service_1.is_income_category)(category.semantic_code);
        let monthly_id;
        let weekly_id;
        let bi_weekly_id;
        let source;
        let outflow_id;
        let inflow_id;
        let budget_reason;
        let tie = false;
        let recurring_reason;
        // A manual pin is GLOBAL — it forces ALL THREE lenses onto the pinned budget.
        // Honored only while that budget still EXISTS (a real budget of any cadence, or
        // any lens's Everything Else). A stale pin (budget deleted) falls through to
        // per-lens category matching so the split re-homes. A pin to any lens's Everything Else
        // means "Everything Else": each lens stores ITS Everything Else (as the page counts it).
        const pin_is_ee = exports.PERIOD_LENSES.some((lens) => context.everything_else_budget_ids[lens] === split.budget_id);
        // A pin to a real budget holds only while that budget is ACTIVE on the transaction's date
        // (a September purchase pinned to a budget that starts in October would count nowhere — its
        // period doesn't exist); else it falls back to category matching, as on the page.
        const pin_budget_valid = pin_is_ee ||
            context.real_budgets.some((b) => b.id === split.budget_id && (0, match_budget_service_1.is_within_budget_range)(context.txn_date_ms, b));
        if (split.budget_assignment_source === "manual" && pin_budget_valid) {
            source = "manual";
            monthly_id = weekly_id = bi_weekly_id = split.budget_id;
            if (pin_is_ee) {
                const ee = context.everything_else_budget_ids;
                monthly_id = (_l = ee.monthly) !== null && _l !== void 0 ? _l : split.budget_id;
                weekly_id = (_m = ee.weekly) !== null && _m !== void 0 ? _m : split.budget_id;
                bi_weekly_id = (_o = ee.bi_monthly) !== null && _o !== void 0 ? _o : split.budget_id;
            }
            outflow_id = null;
            inflow_id = null;
            budget_reason = "manual";
            recurring_reason = "manual_detached";
        }
        else {
            source = "category";
            // 1. Effective category already resolved above (`resolved_plaid`).
            // 2. Recurring (injected from the recurring matchers).
            const recurring = (_p = context.recurring_by_split[split.split_id]) !== null && _p !== void 0 ? _p : {
                outflow_id: null,
                inflow_id: null,
            };
            outflow_id = recurring.outflow_id;
            inflow_id = recurring.inflow_id;
            recurring_reason = outflow_id ? "outflow" : inflow_id ? "inflow" : "none";
            // 3. Budget PER LENS: a budget of ANY cadence owns its categories in every lens (as the
            //    period page counts it — domain/budgets/match_budgets), else that lens's Everything
            //    Else. EXCEPT income (B1) and transfers: unassigned in every lens. Any recurring
            //    inflow/outflow match above still applies for tracking.
            if (is_income || is_transfer) {
                monthly_id = weekly_id = bi_weekly_id = match_budget_service_1.UNASSIGNED_BUDGET_ID;
                budget_reason = is_transfer ? "transfer_excluded" : "income_excluded";
            }
            else {
                // Slugs only (canon A2) — the function's first (Plaid's, when a stored pick is unreadable).
                const split_cat = { first_category_id: category.first_category_id };
                const per_lens = {};
                for (const lens of exports.PERIOD_LENSES) {
                    per_lens[lens] = (0, match_budget_service_1.match_budget)(split_cat, context.txn_date_ms, context.real_budgets, context.everything_else_budget_ids[lens]);
                }
                monthly_id = per_lens.monthly.budget_id;
                weekly_id = per_lens.weekly.budget_id;
                bi_weekly_id = per_lens.bi_monthly.budget_id;
                // reason/tie reflect the monthly lens for logging; tie = ANY lens tie.
                budget_reason = per_lens.monthly.reason;
                tie = exports.PERIOD_LENSES.some((lens) => per_lens[lens].tie);
            }
        }
        // Manual bill pin: the user assigned this split to a specific bill. It OVERRIDES
        // auto-derivation (and a manual-budget detach's null), and is PRESERVED across
        // re-syncs — as long as the pinned outflow still exists (else fall back to auto).
        let outflow_source = "auto";
        let suspended_outflow_pin = null;
        const suppressed = context.suppressed_outflow_ids;
        const is_live = (id) => !context.active_outflow_ids || context.active_outflow_ids.has(id);
        // A pin parked while its bill was removed / paused comes back once the bill is live again for
        // this month — unless the user has since pinned the split to a BUDGET (that pin wins, A4).
        const parked = (_q = split.suspended_outflow_pin) !== null && _q !== void 0 ? _q : null;
        let pin_id = split.outflow_id;
        let pin_source = split.outflow_source;
        if (parked && pin_source !== "manual" && source !== "manual") {
            if (is_live(parked)) {
                pin_id = parked;
                pin_source = "manual";
            }
            else if (suppressed === null || suppressed === void 0 ? void 0 : suppressed.has(parked)) {
                suspended_outflow_pin = parked; // still removed / paused here — keep it parked
            }
        }
        if (pin_source === "manual" && pin_id && (suppressed === null || suppressed === void 0 ? void 0 : suppressed.has(pin_id))) {
            // Pinned to a bill removed / paused for this month: the payment counts as spending, and the
            // pin is parked (not lost) for when the bill is restored.
            suspended_outflow_pin = pin_id;
            outflow_id = null;
        }
        else if (pin_source === "manual" && pin_id && is_live(pin_id)) {
            outflow_id = pin_id;
            outflow_source = "manual";
            recurring_reason = "outflow";
        }
        else if (pin_source === "manual" && !pin_id) {
            // Manual DETACH ("remove from bill"): the user said this split pays NO bill. Durable —
            // beats the recurring matcher / Plaid stream membership, which would otherwise re-link it.
            outflow_id = null;
            outflow_source = "manual";
            recurring_reason = "manual_detached";
        }
        // Manual income pin (Convert-To-Recurring Phase 2): the user said this credit is a payment of a
        // specific income. Honoured only for a CREDIT, never together with a budget pin (a budget pin
        // detaches the income pin — canon A4), and only for the caller's own income in this view (or
        // one removed / paused for this month, kept as stored — readers drop its link on read). A
        // pin to anything else is dropped and the split falls back to auto-derivation.
        let inflow_source = "auto";
        if (split.inflow_source === "manual" && split.inflow_id && source !== "manual" && context.txn_is_income &&
            (((_r = context.active_inflow_ids) === null || _r === void 0 ? void 0 : _r.has(split.inflow_id)) || ((_s = context.suppressed_inflow_ids) === null || _s === void 0 ? void 0 : _s.has(split.inflow_id)))) {
            inflow_id = split.inflow_id;
            inflow_source = "manual";
            recurring_reason = "inflow";
            // An income payment is not also a bill payment (a "remove from bill" detach stays).
            if (!(outflow_source === "manual" && !outflow_id))
                outflow_id = null;
        }
        // Edge money (3d: a transfer crossing the view — edge_out / edge_in) is never a bill payment
        // or a paycheck: the period page drops every recurring link on it (stream membership, split
        // links, manual pins) and counts it as spending / money in. Store no link either. The user's
        // own bill choices survive a later sharing change: a manual bill pin is PARKED (as for a
        // removed bill), and a "remove from bill" detach stays (it already means "no bill").
        if (context.txn_transfer_role === "edge_out" || context.txn_transfer_role === "edge_in") {
            if (outflow_source === "manual" && outflow_id)
                suspended_outflow_pin = outflow_id;
            const keep_detach = outflow_source === "manual" && !outflow_id;
            outflow_id = null;
            // A manual income pin stays as stored (the readers drop every link on edge money).
            inflow_id = inflow_source === "manual" ? inflow_id : null;
            outflow_source = keep_detach ? "manual" : "auto";
            recurring_reason = keep_detach ? "manual_detached" : "none";
        }
        // Missing-EE error: any lens unassigned for a NON-income, NON-transfer split
        // (income/transfers being unassigned in every lens is intentional, not the
        // missing-EE error).
        if (!is_income &&
            !is_transfer &&
            (monthly_id === match_budget_service_1.UNASSIGNED_BUDGET_ID ||
                weekly_id === match_budget_service_1.UNASSIGNED_BUDGET_ID ||
                bi_weekly_id === match_budget_service_1.UNASSIGNED_BUDGET_ID)) {
            any_unassigned = true;
        }
        touched.add(monthly_id); // after
        touched.add(weekly_id);
        touched.add(bi_weekly_id);
        if (outflow_id)
            touched_outflow.add(outflow_id); // after
        if (inflow_id)
            touched_inflow.add(inflow_id); // after
        const next = {
            split_id: split.split_id,
            monthly_budget_id: monthly_id,
            weekly_budget_id: weekly_id,
            bi_weekly_budget_id: bi_weekly_id,
            budget_assignment_source: source,
            budget_id: monthly_id, // legacy alias
            outflow_id,
            outflow_source,
            suspended_outflow_pin,
            inflow_id,
            inflow_source,
            monthly_period_id: periods.monthly_period_id,
            weekly_period_id: periods.weekly_period_id,
            bi_weekly_period_id: periods.bi_weekly_period_id,
            overall_category_id,
            first_category_id,
            second_category_id,
            category_source,
            reason: { budget: budget_reason, tie, recurring: recurring_reason },
        };
        assigned.push(next);
        if (split_assignment_changed(split, next)) {
            changed = true;
        }
    }
    return {
        splits: assigned,
        touched_budget_ids: [...touched],
        touched_outflow_ids: [...touched_outflow],
        touched_inflow_ids: [...touched_inflow],
        changed,
        any_unassigned,
    };
}
/** Whether any engine-owned field differs between the stored split and the new one. PURE. */
function split_assignment_changed(before, after) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    // Prior per-lens ids fall back to the legacy monthly `budget_id` for
    // pre-migration docs — so a first pass that stamps the three lens fields
    // correctly registers as a change.
    return (((_a = before.monthly_budget_id) !== null && _a !== void 0 ? _a : before.budget_id) !== after.monthly_budget_id ||
        ((_b = before.weekly_budget_id) !== null && _b !== void 0 ? _b : before.budget_id) !== after.weekly_budget_id ||
        ((_c = before.bi_weekly_budget_id) !== null && _c !== void 0 ? _c : before.budget_id) !== after.bi_weekly_budget_id ||
        before.budget_assignment_source !== after.budget_assignment_source ||
        before.outflow_id !== after.outflow_id ||
        ((_d = before.outflow_source) !== null && _d !== void 0 ? _d : "auto") !== after.outflow_source ||
        ((_e = before.suspended_outflow_pin) !== null && _e !== void 0 ? _e : null) !== after.suspended_outflow_pin ||
        before.inflow_id !== after.inflow_id ||
        ((_f = before.inflow_source) !== null && _f !== void 0 ? _f : "auto") !== after.inflow_source ||
        before.monthly_period_id !== after.monthly_period_id ||
        before.weekly_period_id !== after.weekly_period_id ||
        before.bi_weekly_period_id !== after.bi_weekly_period_id ||
        // App-category classification (populates on first pass; preserves user overrides).
        ((_g = before.overall_category_id) !== null && _g !== void 0 ? _g : null) !== after.overall_category_id ||
        ((_h = before.first_category_id) !== null && _h !== void 0 ? _h : null) !== after.first_category_id ||
        ((_j = before.second_category_id) !== null && _j !== void 0 ? _j : null) !== after.second_category_id ||
        ((_k = before.category_source) !== null && _k !== void 0 ? _k : "plaid") !== after.category_source);
}
//# sourceMappingURL=compute_transaction_assignment.service.js.map