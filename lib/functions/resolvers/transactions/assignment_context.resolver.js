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
exports.resolve_assignment_context = resolve_assignment_context;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const budget_repo_1 = require("../../repositories/budget.repo");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const category_repo_1 = require("../../repositories/category.repo");
const recurring_matches_resolver_1 = require("./recurring_matches.resolver");
/**
 * Resolve the assignment context for a transaction.
 *
 * @returns The resolved context, or null if the transaction is missing/inactive.
 */
async function resolve_assignment_context(ctx, user_id, transaction_id) {
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
    // Real budgets (+ the Everything Else id for the structural fallback).
    const budgets = await budget_repo_1.budget_repo.get_by_user_id(ctx, user_id);
    const real_budgets = [];
    const budget_names = {};
    let everything_else_budget_id = null;
    for (const b of budgets) {
        budget_names[b.id] = b.name;
        if (b.is_system_everything_else) {
            everything_else_budget_id = b.id;
            continue;
        }
        const end_ts = (_b = b.budget_end_date) !== null && _b !== void 0 ? _b : b.end_date;
        real_budgets.push({
            id: b.id,
            category_ids: b.category_ids,
            start_ms: b.start_date.toMillis(),
            end_ms: b.is_ongoing ? null : end_ts.toMillis(),
            is_ongoing: b.is_ongoing,
        });
    }
    // Source periods overlapping the transaction date.
    const anchor = firestore_1.Timestamp.fromMillis(txn_date_ms);
    const periods = await source_period_repo_1.source_period_repo.get_overlapping(ctx, anchor, anchor);
    const source_periods = periods.map((p) => ({
        id: p.id,
        type: p.period_type,
        start_ms: p.start_date.toMillis(),
        end_ms: p.end_date.toMillis(),
    }));
    // Category rules (merchants / keywords). The category DOC ID (= the detailed
    // Plaid enum) is the match vocabulary, so a merchant/keyword upgrade yields a
    // value that matches a budget's `categoryIds`.
    const category_docs = await category_repo_1.category_repo.get_active(ctx);
    const category_rules = category_docs.map(({ id, data: c }) => {
        var _a, _b;
        return ({
            category: id,
            merchants: (_a = c.merchants) !== null && _a !== void 0 ? _a : [],
            keywords: (_b = c.keywords) !== null && _b !== void 0 ? _b : [],
        });
    });
    // The engine matches budgets on the DETAILED Plaid category: category doc ids
    // ARE the detailed enums, budgets store them in `categoryIds`, and splits
    // carry the same enum in `plaidDetailedCategory`. We feed that detailed enum
    // into the engine's `*_match_category` fields (the matching vocabulary).
    // `internalDetailedCategory` is the user override; falls back to the Plaid
    // detailed enum.
    const splits_input = raw_splits.map((s) => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        return ({
            split_id: s.splitId,
            budget_id: (_a = s.budgetId) !== null && _a !== void 0 ? _a : "unassigned",
            budget_assignment_source: (_b = s.budgetAssignmentSource) !== null && _b !== void 0 ? _b : "category",
            internal_match_category: (_c = s.internalDetailedCategory) !== null && _c !== void 0 ? _c : null,
            plaid_match_category: (_d = s.plaidDetailedCategory) !== null && _d !== void 0 ? _d : "OTHER_EXPENSE",
            outflow_id: (_e = s.outflowId) !== null && _e !== void 0 ? _e : null,
            inflow_id: (_f = s.inflowId) !== null && _f !== void 0 ? _f : null,
            monthly_period_id: (_g = s.monthlyPeriodId) !== null && _g !== void 0 ? _g : null,
            weekly_period_id: (_h = s.weeklyPeriodId) !== null && _h !== void 0 ? _h : null,
            bi_weekly_period_id: (_j = s.biWeeklyPeriodId) !== null && _j !== void 0 ? _j : null,
        });
    });
    const txn_merchant_name = (_c = data.merchantName) !== null && _c !== void 0 ? _c : null;
    const txn_type = (_d = data.type) !== null && _d !== void 0 ? _d : "expense";
    // Recurring (bill) matches → outflow_id per split. Inflow deferred.
    const recurring_by_split = await (0, recurring_matches_resolver_1.resolve_recurring_matches)(ctx, user_id, txn_type, txn_merchant_name, txn_date_ms, raw_splits.map((s) => {
        var _a;
        return ({
            split_id: s.splitId,
            amount: (_a = s.amount) !== null && _a !== void 0 ? _a : 0,
        });
    }));
    const context = {
        txn_date_ms,
        txn_merchant_name,
        txn_name: (_e = data.name) !== null && _e !== void 0 ? _e : null,
        real_budgets,
        everything_else_budget_id,
        category_rules,
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