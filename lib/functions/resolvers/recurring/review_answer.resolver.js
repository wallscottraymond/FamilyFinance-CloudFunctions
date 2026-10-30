"use strict";
/**
 * Review Answer Resolver — READ-ONLY context for answering a review item (D15 / D24).
 *
 * Authorization is by OWNER (never by group): an item id is `${owner_uid}__…`, the stored item's
 * `userId` must be the caller, and the id must be exactly the one rebuilt from the caller's uid +
 * the item's kind + subject (a client-supplied id is never trusted). A question about a record also
 * requires the caller to own that record. A group member answering the owner's item → denied.
 *
 * @module resolvers/recurring/review_answer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolve_review_answer_context = resolve_review_answer_context;
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const repositories_1 = require("../../repositories");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
async function resolve_review_answer_context(ctx, user_id, item_id) {
    if ((0, review_item_service_1.owner_of_review_item_id)(item_id) !== user_id)
        return { ok: false, reason: "permission_denied" };
    const item = await recurring_review_repo_1.recurring_review_repo.get_item(ctx, item_id);
    if (!item)
        return { ok: false, reason: "not_found" };
    if (item.user_id !== user_id)
        return { ok: false, reason: "permission_denied" };
    if ((0, review_item_service_1.build_review_item_id)(user_id, item.kind, item.subject_key) !== item_id) {
        return { ok: false, reason: "permission_denied" };
    }
    let record_owner_ok = true;
    // The record the answer acts on must be the caller's too: "Still a bill" / "It ended" write it,
    // and "Keep separate" decides about it (same bill: the stopped bill) — D24 / X16.
    if (item.record_id && (item.kind === "still_a_bill" || item.kind === "same_bill")) {
        const repo = item.direction === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo;
        const record = await repo.get_by_id(ctx, item.record_id, { include_deleted: true });
        record_owner_ok = !!record && record.user_id === user_id;
    }
    const state = await recurring_review_repo_1.recurring_review_repo.get_state(ctx, user_id);
    return { ok: true, item, state, record_owner_ok };
}
//# sourceMappingURL=review_answer.resolver.js.map