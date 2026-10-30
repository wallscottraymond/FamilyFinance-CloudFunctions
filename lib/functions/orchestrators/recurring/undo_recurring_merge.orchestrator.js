"use strict";
/**
 * Undo Recurring Merge Orchestrator (Convert-To-Recurring D18 / D22 / D41, review items 8-9, 13).
 *
 * Two undos, both owner-only and flag-gated:
 *   - `merge`: a same-bill merge (or a convert over an old bill) — the old bill gets its intervals
 *     back, loses mergedIntoId / mergeLog, the new bill's inherited name / override are reset where
 *     the user hasn't changed them since, the "same bill?" question becomes `keep_separate`, and the
 *     account re-assigns once. The merge target may be gone (deleted): the old bill is still restored.
 *   - `absorb`: a Plaid stream a converted bill absorbed is marked `declined`; the next sync creates
 *     a separate bill for it.
 * Ownership is checked on the old bill AND on the merge target.
 *
 * @module orchestrators/recurring/undo_recurring_merge
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.undo_recurring_merge_orchestrator = undo_recurring_merge_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const purge_guard_1 = require("../../infrastructure/purge_guard");
const repositories_1 = require("../../repositories");
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const merge_service_1 = require("../../domain/recurring/merge.service");
const absorb_service_1 = require("../../domain/recurring/absorb.service");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
const reassign_user_orchestrator_1 = require("../transactions/reassign_user.orchestrator");
async function undo_recurring_merge_orchestrator(ctx, user_id, input, now_ms) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "undo_recurring_merge");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        if (!(await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id)))
            throw new types_1.ConvertRefusedError("FEATURE_OFF", "Undo isn't available on this account yet");
        if (await (0, purge_guard_1.is_user_purging)(user_id))
            throw new types_1.ConvertRefusedError("PURGING", "This account is being erased");
        const repo = input.kind === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo;
        const record = await repo.get_by_id(ctx, input.record_id, { include_deleted: true });
        if (!record)
            throw new types_1.NotFoundError(input.kind, input.record_id);
        if (record.user_id !== user_id)
            throw new types_1.PermissionDeniedError("undo_recurring_merge", input.record_id);
        const run_id = `undo_${ctx.trace_id}`;
        if (input.mode === "absorb") {
            const next = (0, absorb_service_1.decline_absorbed_stream)((_a = record.absorbed_streams) !== null && _a !== void 0 ? _a : [], input.stream_id, now_ms);
            if (!next)
                return { record_id: input.record_id, mode: "absorb", no_op: true };
            await repo.record_absorbed(ctx, input.record_id, next.streams, next.txn_ids, run_id);
            await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
            (0, observability_1.log_operation_success)(span, user_id);
            return { record_id: input.record_id, mode: "absorb", no_op: false };
        }
        const log = record.merge_log;
        if (!record.merged_into_id || !log)
            return { record_id: input.record_id, mode: "merge", no_op: true };
        // The merge target: owner-checked when it exists; a deleted one is fine.
        const target = await repo.get_by_id(ctx, log.into, { include_deleted: true });
        if (target && target.user_id !== user_id)
            throw new types_1.PermissionDeniedError("undo_recurring_merge", log.into);
        const plan = (0, merge_service_1.plan_undo_merge)(log, target ? {
            user_custom_name: target.user_custom_name, expected_amount_override: target.expected_amount_override,
        } : null);
        await repo.clear_merge(ctx, input.record_id, plan.restore_intervals, run_id, log.prior_is_active);
        await repo.apply_period_suppression(ctx, input.record_id, plan.restore_intervals, user_id);
        if (target && (plan.revert_target_name || plan.revert_target_override)) {
            await repo.revert_inherited(ctx, target.id, { name: plan.revert_target_name, override: plan.revert_target_override }, run_id);
        }
        // The "same bill?" question (keyed by the new stream) goes back to "keep separate".
        const item_id = (0, review_item_service_1.build_review_item_id)(user_id, "same_bill", log.into);
        const item = (await recurring_review_repo_1.recurring_review_repo.get_items_by_ids(ctx, [item_id])).get(item_id);
        if (item && item.status === "resolved" && item.answer === "same_bill") {
            await recurring_review_repo_1.recurring_review_repo.upsert_items(ctx, [(0, review_item_service_1.resolve_review_item)(item, "keep_separate", now_ms)]);
        }
        await (0, reassign_user_orchestrator_1.enqueue_reassign_user)({
            user_id, reason: "recurring_removal",
            scope: Object.assign({}, (record.account_id ? { account_ids: [record.account_id] } : {})),
        }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] undo re-assign enqueue failed:`, e));
        await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
        (0, observability_1.log_operation_success)(span, user_id);
        return { record_id: input.record_id, mode: "merge", no_op: false };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=undo_recurring_merge.orchestrator.js.map