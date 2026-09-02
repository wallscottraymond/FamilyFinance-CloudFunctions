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
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const category_repo_1 = require("../../repositories/category.repo");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const stream_membership_1 = require("../../domain/recurring/stream_membership");
const budgets_1 = require("../../domain/budgets");
const recurring_matches_resolver_1 = require("./recurring_matches.resolver");
/**
 * Resolve the transaction-independent shared context for a user (budgets +
 * categories). Loaded once per batch; pass into `resolve_assignment_context` to
 * skip the per-transaction re-reads.
 */
async function resolve_shared_assignment_context(ctx, user_id) {
    var _a, _b, _c;
    // Budgets (per-user) and category rules (cached reference data) are
    // independent — fetch concurrently.
    const [budgets, category_docs, outflows, inflows] = await Promise.all([
        budget_repo_1.budget_repo.get_by_user_id(ctx, user_id),
        category_repo_1.category_repo.get_active_cached(ctx),
        outflow_repo_1.outflow_repo.get_by_user_id(ctx, user_id),
        inflow_repo_1.inflow_repo.get_by_user_id(ctx, user_id),
    ]);
    // Authoritative recurring-stream links: Plaid stream `transactionIds` → recurring id.
    // Only ACTIVE, non-hidden defs (hidden = classified internal transfer) contribute, so
    // a txn is linked to a bill/income exactly as the derive-on-read read path does. A txn
    // claimed by two streams is excluded (no guessing — see build_stream_membership_map).
    const outflow_tx_to_id = (0, stream_membership_1.build_stream_membership_map)(outflows.filter((o) => o.is_active && !o.is_hidden));
    const inflow_tx_to_id = (0, stream_membership_1.build_stream_membership_map)(inflows.filter((i) => i.is_active && !i.is_hidden));
    // Real budgets (+ the Everything Else id PER LENS for the structural fallback).
    // A budget's period maps to exactly one lens (weekly/monthly/bi_monthly); the
    // three EE budgets are keyed by their own lens.
    const real_budgets = [];
    const budget_names = {};
    const everything_else_budget_ids = {
        monthly: null,
        weekly: null,
        bi_monthly: null,
    };
    for (const b of budgets) {
        budget_names[b.id] = b.name;
        const cadence = (0, budgets_1.budget_cadence_to_instance)(b.period);
        if (b.is_system_everything_else) {
            // The EE budget's `period` IS its lens (new EE budgets set period = lens;
            // the legacy single EE has period 'monthly').
            if (!everything_else_budget_ids[cadence]) {
                everything_else_budget_ids[cadence] = b.id;
            }
            continue;
        }
        const end_ts = (_a = b.budget_end_date) !== null && _a !== void 0 ? _a : b.end_date;
        real_budgets.push({
            id: b.id,
            category_ids: b.category_ids,
            start_ms: b.start_date.toMillis(),
            end_ms: b.is_ongoing ? null : end_ts.toMillis(),
            is_ongoing: b.is_ongoing,
            cadence,
        });
    }
    // Category rules (merchants / keywords). The category DOC ID (= the detailed
    // Plaid enum) is the match vocabulary, so a merchant/keyword upgrade yields a
    // value that matches a budget's `categoryIds`.
    const category_rules = category_docs.map(({ id, data: c }) => {
        var _a, _b;
        return ({
            category: id,
            merchants: (_a = c.merchants) !== null && _a !== void 0 ? _a : [],
            keywords: (_b = c.keywords) !== null && _b !== void 0 ? _b : [],
        });
    });
    // App-category slug lookup: the category DOC ID is the Plaid detailed, so this
    // maps a split's resolved Plaid detailed → its two user-facing category slugs
    // (Simplified-Transaction-Categories). Built once per user, reused per txn.
    const category_slugs_by_plaid = {};
    for (const { id, data: c } of category_docs) {
        category_slugs_by_plaid[id] = {
            overall_category_id: (_b = c.overallCategoryId) !== null && _b !== void 0 ? _b : null,
            first_category_id: (_c = c.firstCategoryId) !== null && _c !== void 0 ? _c : null,
        };
    }
    return {
        real_budgets,
        budget_names,
        everything_else_budget_ids,
        category_rules,
        category_slugs_by_plaid,
        outflow_tx_to_id,
        inflow_tx_to_id,
    };
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
async function resolve_assignment_context(ctx, user_id, transaction_id, shared) {
    var _a, _b, _c, _d, _e;
    const span = (0, observability_1.create_span)(ctx, "resolver", "resolve_assignment_context");
    (0, observability_1.log_operation_start)(span, user_id);
    const txn = await transaction_repo_1.transaction_repo.get_raw_by_id(ctx, transaction_id);
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
    const [periods, recurring_by_split] = await Promise.all([
        source_period_repo_1.source_period_repo.get_overlapping(ctx, anchor, anchor),
        (0, recurring_matches_resolver_1.resolve_recurring_matches)(ctx, user_id, txn_type, txn_merchant_name, txn_date_ms, raw_splits.map((s) => {
            var _a;
            return ({
                split_id: s.splitId,
                amount: (_a = s.amount) !== null && _a !== void 0 ? _a : 0,
            });
        }), {
            txn_plaid_id,
            outflow_tx_to_id: resolved_shared.outflow_tx_to_id,
            inflow_tx_to_id: resolved_shared.inflow_tx_to_id,
        }),
    ]);
    const { real_budgets, budget_names, everything_else_budget_ids, category_rules, category_slugs_by_plaid, } = resolved_shared;
    // Source periods overlapping the transaction date.
    const source_periods = periods.map((p) => ({
        id: p.id,
        type: p.period_type,
        start_ms: p.start_date.toMillis(),
        end_ms: p.end_date.toMillis(),
    }));
    // The engine matches budgets on the DETAILED Plaid category: category doc ids
    // ARE the detailed enums, budgets store them in `categoryIds`, and splits
    // carry the same enum in `plaidDetailedCategory`. We feed that detailed enum
    // into the engine's `*_match_category` fields (the matching vocabulary).
    // `internalDetailedCategory` is the user override; falls back to the Plaid
    // detailed enum.
    const splits_input = raw_splits.map((s) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        return ({
            split_id: s.splitId,
            budget_id: (_a = s.budgetId) !== null && _a !== void 0 ? _a : "unassigned",
            budget_assignment_source: (_b = s.budgetAssignmentSource) !== null && _b !== void 0 ? _b : "category",
            // Prior per-lens assignments (for the touched-set + skip-if-unchanged). Fall
            // back to the legacy monthly `budgetId` for pre-migration docs.
            monthly_budget_id: (_c = s.monthlyBudgetId) !== null && _c !== void 0 ? _c : undefined,
            weekly_budget_id: (_d = s.weeklyBudgetId) !== null && _d !== void 0 ? _d : undefined,
            bi_weekly_budget_id: (_e = s.biWeeklyBudgetId) !== null && _e !== void 0 ? _e : undefined,
            internal_match_category: (_f = s.internalDetailedCategory) !== null && _f !== void 0 ? _f : null,
            plaid_match_category: (_g = s.plaidDetailedCategory) !== null && _g !== void 0 ? _g : "OTHER_EXPENSE",
            outflow_id: (_h = s.outflowId) !== null && _h !== void 0 ? _h : null,
            // Manual bill-pin source — preserved so a user's bill assignment survives re-sync.
            outflow_source: (_j = s.outflowAssignmentSource) !== null && _j !== void 0 ? _j : "auto",
            inflow_id: (_k = s.inflowId) !== null && _k !== void 0 ? _k : null,
            monthly_period_id: (_l = s.monthlyPeriodId) !== null && _l !== void 0 ? _l : null,
            weekly_period_id: (_m = s.weeklyPeriodId) !== null && _m !== void 0 ? _m : null,
            bi_weekly_period_id: (_o = s.biWeeklyPeriodId) !== null && _o !== void 0 ? _o : null,
            // App-category classification: prior slugs + source (preserved when "user").
            overall_category_id: (_p = s.overallCategoryId) !== null && _p !== void 0 ? _p : null,
            first_category_id: (_q = s.firstCategoryId) !== null && _q !== void 0 ? _q : null,
            second_category_id: (_r = s.secondCategoryId) !== null && _r !== void 0 ? _r : null,
            category_source: (_s = s.categorySource) !== null && _s !== void 0 ? _s : "plaid",
        });
    });
    const context = {
        txn_date_ms,
        txn_merchant_name,
        txn_name: (_e = data.name) !== null && _e !== void 0 ? _e : null,
        txn_is_income: txn_type === "income",
        real_budgets,
        everything_else_budget_ids,
        category_rules,
        category_slugs_by_plaid,
        source_periods,
        recurring_by_split,
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