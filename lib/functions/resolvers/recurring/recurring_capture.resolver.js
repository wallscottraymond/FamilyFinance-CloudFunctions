"use strict";
/**
 * Recurring Capture Resolver (Convert-To-Recurring Phase 1) — READ-ONLY.
 *
 * What the capture planner needs beyond the sync's own reads, loaded only when the planner runs
 * (flag on, or the user has v2 records — X11):
 *   - the user's review state (ONE get, X8);
 *   - the review items at the deterministic ids of the subjects in this response (ONE getAll — no
 *     query, X8);
 *   - lazily, the user's INACTIVE records (same-bill candidates), only when a new v2 stream needs
 *     one (X9).
 *
 * @module resolvers/recurring/recurring_capture
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_capture_review_context = resolve_capture_review_context;
exports.resolve_inactive_capture_records = resolve_inactive_capture_records;
exports.capture_records_from_raw = capture_records_from_raw;
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const repositories_1 = require("../../repositories");
const account_repo_1 = require("../../repositories/account.repo");
const recurring_sync_resolver_1 = require("../plaid/recurring_sync.resolver");
async function resolve_capture_review_context(ctx, user_id, review_ids, plaid_item_doc_id) {
    var _a, _b;
    const [state, items] = await Promise.all([
        recurring_review_repo_1.recurring_review_repo.get_state(ctx, user_id),
        recurring_review_repo_1.recurring_review_repo.get_items_by_ids(ctx, review_ids),
    ]);
    // Pending tracks of this Plaid item (or handed off by another item — round 4 defect 2) and the
    // open suggested tiles this item owns, whose item wasn't among the subjects in hand (the stream
    // is gone from the response): one more getAll, only then (≈ never in steady state).
    const missing = [
        ...((_a = state === null || state === void 0 ? void 0 : state.pending_tracks) !== null && _a !== void 0 ? _a : [])
            .filter((p) => p.plaid_item_doc_id === plaid_item_doc_id || typeof p.handed_off_ms === "number")
            .map((p) => p.item_id),
        ...((_b = state === null || state === void 0 ? void 0 : state.suggested_owners) !== null && _b !== void 0 ? _b : []).filter((o) => o.plaid_item_doc_id === plaid_item_doc_id).map((o) => o.item_id),
    ].filter((id) => !items.has(id));
    if (missing.length > 0) {
        for (const [id, item] of await recurring_review_repo_1.recurring_review_repo.get_items_by_ids(ctx, missing))
            items.set(id, item);
    }
    return { state, items };
}
/** The user's inactive bills + income (same-bill candidates) + their active Plaid account ids. */
async function resolve_inactive_capture_records(ctx, user_id) {
    const [outflows, inflows, accounts] = await Promise.all([
        repositories_1.outflow_repo.get_inactive_by_user_id(ctx, user_id),
        repositories_1.inflow_repo.get_inactive_by_user_id(ctx, user_id),
        account_repo_1.account_repo.get_by_user_id(ctx, user_id),
    ]);
    return {
        records: [
            ...outflows.map((o) => (0, recurring_sync_resolver_1.to_capture_record_info)(o, "outflow", o.merchant_name)),
            ...inflows.map((i) => (0, recurring_sync_resolver_1.to_capture_record_info)(i, "inflow", i.payer_name)),
        ],
        active_account_ids: new Set(accounts.filter((a) => a.is_active !== false).flatMap((a) => [a.account_id, a.id].filter(Boolean))),
    };
}
/** Raw prefetched docs → planner records (no reads). */
function capture_records_from_raw(outflow_docs, inflow_docs) {
    const out = new Map();
    for (const [id, d] of outflow_docs) {
        const e = repositories_1.outflow_repo.entity_from_raw(d);
        out.set(id, (0, recurring_sync_resolver_1.to_capture_record_info)(e, "outflow", e.merchant_name));
    }
    for (const [id, d] of inflow_docs) {
        const e = repositories_1.inflow_repo.entity_from_raw(d);
        out.set(id, (0, recurring_sync_resolver_1.to_capture_record_info)(e, "inflow", e.payer_name));
    }
    return out;
}
//# sourceMappingURL=recurring_capture.resolver.js.map