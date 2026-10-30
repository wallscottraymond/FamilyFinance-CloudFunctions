"use strict";
/**
 * Deleting a bill / income that others depend on (Convert-To-Recurring review item 9, P9, P10).
 *
 *   - Records MERGED INTO it (a same-bill merge or a convert over an old bill) are un-merged first:
 *     their intervals come back, so a hard delete never strands an old bill with a dangling
 *     `mergedIntoId` (hidden from Removed, no Restore, no undo target).
 *   - Plaid streams IT ABSORBED are remembered as declined: their vendor is written as "Not a bill"
 *     and their payments are held out of fuzzy matching, so the next sync never brings them back as
 *     a new Plaid bill (deleting the last converted bill would otherwise turn the absorber off and
 *     let the stream be saved).
 * Nothing happens for a record with neither (the common case: one query).
 *
 * @module orchestrators/recurring/converted_delete
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handle_converted_delete = handle_converted_delete;
const repositories_1 = require("../../repositories");
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
const reassign_user_orchestrator_1 = require("../transactions/reassign_user.orchestrator");
async function handle_converted_delete(ctx, user_id, kind, id) {
    var _a, _b, _c, _d;
    const repo = kind === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo;
    const record = await repo.get_by_id(ctx, id, { include_deleted: true });
    if (!record || record.user_id !== user_id)
        return;
    const run_id = `delete_${ctx.trace_id}`;
    let changed = false;
    try {
        for (const m of await repo.get_merged_into(ctx, user_id, id)) {
            const old = await repo.get_by_id(ctx, m.id, { include_deleted: true });
            const intervals = (_a = old === null || old === void 0 ? void 0 : old.merge_log) === null || _a === void 0 ? void 0 : _a.prior_intervals;
            if (!old || !intervals)
                continue;
            changed = true; // a write is attempted: the bump below must run even if a later step fails
            await repo.clear_merge(ctx, old.id, intervals, run_id, (_b = old.merge_log) === null || _b === void 0 ? void 0 : _b.prior_is_active);
            await repo.apply_period_suppression(ctx, old.id, intervals, user_id);
            await (0, reassign_user_orchestrator_1.enqueue_reassign_user)({
                user_id, reason: "recurring_removal",
                scope: Object.assign({}, (old.account_id ? { account_ids: [old.account_id] } : {})),
            }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] unmerge re-assign enqueue failed:`, e));
            changed = true;
        }
        const absorbed = ((_c = record.absorbed_streams) !== null && _c !== void 0 ? _c : []).filter((s) => s.state === "absorbed");
        if (absorbed.length > 0) {
            // Its own vendor AND each absorbed stream's (they can differ): none may return as a new bill.
            const vendors = [...new Set([record.vendor_key, ...absorbed.map((a) => a.vendor_key)].filter((v) => !!v))];
            changed = true;
            await recurring_review_repo_1.recurring_review_repo.apply_state_change(ctx, user_id, {
                add_dismissed_vendor_keys: vendors.map((v) => (0, review_item_service_1.suggested_subject)(kind, v)),
                add_suppressed: (_d = record.absorbed_txn_ids) !== null && _d !== void 0 ? _d : [],
            });
            changed = true;
            // The sync already reads its Plaid item: mark them so the planner (which honours this memory)
            // still runs when no other v2 record is left and the flag is off (C).
            await plaid_item_repo_1.plaid_item_repo.set_review_memory(ctx, await plaid_item_repo_1.plaid_item_repo.get_active_doc_ids_by_user(ctx, user_id));
        }
    }
    finally {
        // Always bumped when any write was attempted, even if a later step threw.
        if (changed)
            await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
    }
}
//# sourceMappingURL=converted_delete.js.map