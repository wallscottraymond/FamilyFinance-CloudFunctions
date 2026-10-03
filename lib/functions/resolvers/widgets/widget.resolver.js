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
exports.resolve_stored_widget_token = resolve_stored_widget_token;
const firestore_1 = require("firebase-admin/firestore");
const widget_token_repo_1 = require("../../repositories/widget_token.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const source_period_repo_1 = require("../../repositories/source_period.repo");
/** Owner of a widget token hash (null = unknown/revoked) + their current data version. */
async function resolve_widget_request(token_hash) {
    const user_id = await widget_token_repo_1.widget_token_repo.get_user_by_hash(token_hash);
    if (!user_id)
        return null;
    const data_version = await (0, derive_version_repo_1.get_derive_version)(user_id);
    return { user_id, data_version };
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
/** The account's stored widget token (encrypted), or null. */
async function resolve_stored_widget_token(user_id) {
    return widget_token_repo_1.widget_token_repo.get_for_user(user_id);
}
//# sourceMappingURL=widget.resolver.js.map