"use strict";
/**
 * Widget Resolver ([[iOS-Home-Screen-Widgets]] Phase 2) — READ-ONLY lookups for the widget
 * endpoint and token callable.
 *
 * @module resolvers/widgets/widget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_widget_request = resolve_widget_request;
exports.resolve_source_periods_from_now = resolve_source_periods_from_now;
exports.resolve_recent_view_transactions = resolve_recent_view_transactions;
exports.resolve_bill_names = resolve_bill_names;
exports.resolve_stored_widget_token = resolve_stored_widget_token;
const firestore_1 = require("firebase-admin/firestore");
const widget_token_repo_1 = require("../../repositories/widget_token.repo");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const derive_scope_resolver_1 = require("../periods/derive_scope.resolver");
const derive_scope_service_1 = require("../../domain/periods/derive_scope.service");
/** Owner of a widget token hash (null = unknown/revoked). The view version is resolved by the
 *  caller (`resolve_view_version`), which knows whether this is a Me or a group widget. */
async function resolve_widget_request(token_hash) {
    const user_id = await widget_token_repo_1.widget_token_repo.get_user_by_hash(token_hash);
    if (!user_id)
        return null;
    return { user_id };
}
/**
 * The `cadence` source periods from the one containing `now_ms` onward, soonest first
 * (`count` of them: 1 = current; 2 = current + next, for "bills due soon").
 */
async function resolve_source_periods_from_now(ctx, cadence, now_ms, count) {
    const lookahead_ms = count > 1 ? 45 * 24 * 60 * 60 * 1000 : 0; // covers the next month
    const periods = await source_period_repo_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(now_ms), firestore_1.Timestamp.fromMillis(now_ms + lookahead_ms));
    return periods
        .filter((p) => p.period_type === cadence && p.end_date.toMillis() >= now_ms)
        .sort((a, b) => a.start_date.toMillis() - b.start_date.toMillis())
        .slice(0, count);
}
/** How many of each member's newest transactions the Recent widget reads (the app's Home card
 *  reads up to 100 too: a day of many own-account transfers must not starve the list). */
const RECENT_READ_LIMIT = 100;
/**
 * The view's newest transactions, newest first. Raw docs; which rows show is the domain's call
 * (`select_recent_transactions`). READ-ONLY.
 * - Me: every transaction on your own accounts, shared into a group or not: the app's Home
 *   "Recent transactions" card (ownerId only). NOT the period page's Me view, which leaves shared
 *   accounts to the group: with most accounts shared, that left Me nearly empty.
 * - A group: each member's latest RECENT_READ_LIMIT, kept when on the group's shared accounts
 *   (`transaction_in_scope`).
 */
async function resolve_recent_view_transactions(ctx, user_id, scope_request) {
    if (!scope_request || scope_request.kind === "me") {
        return transaction_repo_1.transaction_repo.get_latest_by_owner(ctx, user_id, RECENT_READ_LIMIT);
    }
    const scope = await (0, derive_scope_resolver_1.resolve_derive_scope)(ctx, user_id, scope_request);
    const per_member = await Promise.all(scope.member_ids.map((m) => transaction_repo_1.transaction_repo.get_latest_by_owner(ctx, m, RECENT_READ_LIMIT)));
    return per_member.flat().filter((t) => {
        var _a, _b;
        const date = t.data.transactionDate;
        const account_id = t.data.accountId;
        return (0, derive_scope_service_1.transaction_in_scope)(scope, account_id, (_b = (_a = date === null || date === void 0 ? void 0 : date.toMillis) === null || _a === void 0 ? void 0 : _a.call(date)) !== null && _b !== void 0 ? _b : 0);
    });
}
/** The bills (outflows) the shown rows paid, by id (names): ONE batched read. READ-ONLY. */
async function resolve_bill_names(ctx, outflow_ids) {
    if (outflow_ids.length === 0)
        return new Map();
    return outflow_repo_1.outflow_repo.get_raw_by_ids(ctx, outflow_ids);
}
/** The account's stored widget token (encrypted), or null. */
async function resolve_stored_widget_token(user_id) {
    return widget_token_repo_1.widget_token_repo.get_for_user(user_id);
}
//# sourceMappingURL=widget.resolver.js.map