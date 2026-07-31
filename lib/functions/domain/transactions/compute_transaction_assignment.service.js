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
const match_category_service_1 = require("./match_category.service");
const match_source_periods_service_1 = require("./match_source_periods.service");
/**
 * Assemble the assignment for all of a transaction's splits.
 *
 * PURE FUNCTION.
 */
function compute_transaction_assignment(splits, context) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
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
        // --- App-category classification (Simplified-Transaction-Categories) ---
        // Resolve the effective Plaid detailed ONCE (merchant/keyword upgrade of
        // OTHER_EXPENSE). Reused for the category label (EVERY split) and for budget
        // matching in the category path below.
        const resolved_plaid = (0, match_category_service_1.match_category)({
            plaid_match_category: split.plaid_match_category,
            merchant_name: context.txn_merchant_name,
            name: context.txn_name,
        }, context.category_rules).category;
        // The split's two user-facing category slugs, derived from that resolved Plaid
        // detailed. A user override (`category_source === "user"`) is PRESERVED — the
        // engine never clobbers a manual reclassification.
        let overall_category_id;
        let first_category_id;
        let second_category_id;
        let category_source;
        if (split.category_source === "user") {
            overall_category_id = (_d = split.overall_category_id) !== null && _d !== void 0 ? _d : null;
            first_category_id = (_e = split.first_category_id) !== null && _e !== void 0 ? _e : null;
            second_category_id = (_f = split.second_category_id) !== null && _f !== void 0 ? _f : null;
            category_source = "user";
        }
        else {
            const slugs = context.category_slugs_by_plaid[resolved_plaid];
            overall_category_id = (_g = slugs === null || slugs === void 0 ? void 0 : slugs.overall_category_id) !== null && _g !== void 0 ? _g : null;
            first_category_id = (_h = slugs === null || slugs === void 0 ? void 0 : slugs.first_category_id) !== null && _h !== void 0 ? _h : null;
            // Plaid splits derive their secondary from the resolved detailed at read time
            // (doc id == detailed), so we don't persist it here — avoids write churn.
            second_category_id = null;
            category_source = "plaid";
        }
        // Effective detailed for BUDGET matching: a user override to a specific
        // second_category matches budgets keyed by that detailed; a first-only override
        // has no effective detailed (matches only by first/overall slug); a plaid split
        // uses its resolved detailed as before.
        const effective_detailed = category_source === "user" ? second_category_id : resolved_plaid;
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
        // per-lens category matching so the split re-homes.
        const pin_budget_valid = context.real_budgets.some((b) => b.id === split.budget_id) ||
            exports.PERIOD_LENSES.some((lens) => context.everything_else_budget_ids[lens] === split.budget_id);
        if (split.budget_assignment_source === "manual" && pin_budget_valid) {
            source = "manual";
            monthly_id = weekly_id = bi_weekly_id = split.budget_id;
            outflow_id = null;
            inflow_id = null;
            budget_reason = "manual";
            recurring_reason = "manual_detached";
        }
        else {
            source = "category";
            // 1. Effective category already resolved above (`resolved_plaid`).
            // 2. Recurring (injected from the recurring matchers).
            const recurring = (_j = context.recurring_by_split[split.split_id]) !== null && _j !== void 0 ? _j : {
                outflow_id: null,
                inflow_id: null,
            };
            outflow_id = recurring.outflow_id;
            inflow_id = recurring.inflow_id;
            recurring_reason = outflow_id ? "outflow" : inflow_id ? "inflow" : "none";
            // 3. Budget PER LENS: each cadence is matched INDEPENDENTLY against the real
            //    budgets of THAT cadence, else that lens's Everything Else fallback.
            //    EXCEPT income (B1): unassigned in every lens; recurring inflow above
            //    still applies so income tracking works.
            if (context.txn_is_income) {
                monthly_id = weekly_id = bi_weekly_id = match_budget_service_1.UNASSIGNED_BUDGET_ID;
                budget_reason = "income_excluded";
            }
            else {
                const split_cat = {
                    internal_match_category: split.internal_match_category,
                    plaid_match_category: effective_detailed,
                    // Slug-level budget matching (Phase 4b): a budget may claim this split by
                    // its overall/first slug, not just the Plaid detailed.
                    overall_category_id,
                    first_category_id,
                };
                const per_lens = {};
                for (const lens of exports.PERIOD_LENSES) {
                    per_lens[lens] = (0, match_budget_service_1.match_budget)(split_cat, context.txn_date_ms, context.real_budgets.filter((b) => b.cadence === lens), context.everything_else_budget_ids[lens]);
                }
                monthly_id = per_lens.monthly.budget_id;
                weekly_id = per_lens.weekly.budget_id;
                bi_weekly_id = per_lens.bi_monthly.budget_id;
                // reason/tie reflect the monthly lens for logging; tie = ANY lens tie.
                budget_reason = per_lens.monthly.reason;
                tie = exports.PERIOD_LENSES.some((lens) => per_lens[lens].tie);
            }
        }
        // Missing-EE error: any lens unassigned for a NON-income split (income being
        // unassigned in every lens is intentional B1, not the missing-EE error).
        if (!context.txn_is_income &&
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
            inflow_id,
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
    var _a, _b, _c, _d, _e, _f, _g;
    // Prior per-lens ids fall back to the legacy monthly `budget_id` for
    // pre-migration docs — so a first pass that stamps the three lens fields
    // correctly registers as a change.
    return (((_a = before.monthly_budget_id) !== null && _a !== void 0 ? _a : before.budget_id) !== after.monthly_budget_id ||
        ((_b = before.weekly_budget_id) !== null && _b !== void 0 ? _b : before.budget_id) !== after.weekly_budget_id ||
        ((_c = before.bi_weekly_budget_id) !== null && _c !== void 0 ? _c : before.budget_id) !== after.bi_weekly_budget_id ||
        before.budget_assignment_source !== after.budget_assignment_source ||
        before.outflow_id !== after.outflow_id ||
        before.inflow_id !== after.inflow_id ||
        before.monthly_period_id !== after.monthly_period_id ||
        before.weekly_period_id !== after.weekly_period_id ||
        before.bi_weekly_period_id !== after.bi_weekly_period_id ||
        // App-category classification (populates on first pass; preserves user overrides).
        ((_d = before.overall_category_id) !== null && _d !== void 0 ? _d : null) !== after.overall_category_id ||
        ((_e = before.first_category_id) !== null && _e !== void 0 ? _e : null) !== after.first_category_id ||
        ((_f = before.second_category_id) !== null && _f !== void 0 ? _f : null) !== after.second_category_id ||
        ((_g = before.category_source) !== null && _g !== void 0 ? _g : "plaid") !== after.category_source);
}
//# sourceMappingURL=compute_transaction_assignment.service.js.map