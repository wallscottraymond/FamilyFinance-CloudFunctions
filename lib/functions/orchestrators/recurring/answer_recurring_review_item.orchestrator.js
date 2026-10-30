"use strict";
/**
 * Answer Recurring Review Item Orchestrator (Convert-To-Recurring Phase 1, D9 / D14 / D24).
 *
 * One tap on a Bills-to-review tile (period page or the list — they read the same item):
 *   resolve (owner-only auth) → plan (pure) → write the item + the review state (only if changed;
 *   a held-out-set change bumps the derive version) → the record action ("Still a bill" ack on the
 *   record; "It ended" = the going-forward end, via the removal orchestrator) → for "track" /
 *   "keep separate" a re-sync of the item, so its planner creates the v2 bill now (one sync path:
 *   stamping, periods, linking, follow-ups all as for any new bill).
 *
 * Flag-gated (X11): with the flag off the callable refuses. Idempotent: the same answer again is a
 * no-op (R12).
 *
 * @module orchestrators/recurring/answer_recurring_review_item
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.answer_recurring_review_item_orchestrator = answer_recurring_review_item_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const recurring_review_repo_1 = require("../../repositories/recurring_review.repo");
const repositories_1 = require("../../repositories");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const review_answer_resolver_1 = require("../../resolvers/recurring/review_answer.resolver");
const review_answer_service_1 = require("../../domain/recurring/review_answer.service");
const review_item_service_1 = require("../../domain/recurring/review_item.service");
const manage_recurring_removal_orchestrator_1 = require("./manage_recurring_removal.orchestrator");
const sync_item_orchestrator_1 = require("../plaid/sync_item.orchestrator");
const convert_resolver_1 = require("../../resolvers/recurring/convert.resolver");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const merge_service_1 = require("../../domain/recurring/merge.service");
const last_payment_resolver_1 = require("../../resolvers/recurring/last_payment.resolver");
const reassign_user_orchestrator_1 = require("../transactions/reassign_user.orchestrator");
const convert_transaction_to_recurring_orchestrator_1 = require("./convert_transaction_to_recurring.orchestrator");
const convert_recurring_service_1 = require("../../domain/recurring/convert_recurring.service");
async function answer_recurring_review_item_orchestrator(ctx, user_id, input, now_ms) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "answer_recurring_review_item");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        if (!(await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id))) {
            throw new types_1.ValidationError(["Bills to review isn't available on this account yet"]);
        }
        // 1. Resolve (owner-only).
        const context = await (0, review_answer_resolver_1.resolve_review_answer_context)(ctx, user_id, input.item_id);
        if (!context.ok) {
            if (context.reason === "not_found")
                throw new types_1.NotFoundError("recurring_review_item", input.item_id);
            throw new types_1.PermissionDeniedError("answer_recurring_review_item", input.item_id);
        }
        if (!context.record_owner_ok)
            throw new types_1.PermissionDeniedError("answer_recurring_review_item", input.item_id);
        // 2. Plan (pure).
        const result = (0, review_answer_service_1.plan_review_answer)(context.item, input.answer, now_ms, { frequency: input.frequency });
        if (!result.ok)
            throw new types_1.ValidationError([result.error]);
        const plan = result.plan;
        if (plan.no_op) {
            (0, observability_1.log_operation_success)(span, user_id);
            return { item_id: input.item_id, status: context.item.status, answer: input.answer, no_op: true };
        }
        // 2b. A detector suggestion tracked = converted from its latest payment (D4): the convert
        //     orchestrator makes the bill, links the past payments and closes the item `converted`.
        if (plan.convert) {
            const item = context.item;
            const docs = await transaction_repo_1.transaction_repo.get_raw_by_ids(ctx, item.transaction_ids);
            const latest = docs
                // …of THIS suggestion's vendor (a payment of another vendor would fail the review match).
                .filter((d) => d.data.isActive !== false && d.data.isPending !== true && (!item.account_id || d.data.accountId === item.account_id) &&
                (0, convert_resolver_1.txn_facts)(d.id, d.data, false).vendor_key === item.vendor_key)
                .sort((a, b) => (b.data.transactionDate.toMillis()) - (a.data.transactionDate.toMillis()))[0];
            if (!latest)
                throw new types_1.ValidationError(["the payments behind this suggestion are gone"]);
            const freq = ((_b = (_a = input.frequency) !== null && _a !== void 0 ? _a : item.user_frequency) !== null && _b !== void 0 ? _b : item.frequency);
            if (!freq || !convert_recurring_service_1.CONVERT_FREQUENCIES.includes(freq))
                throw new types_1.ValidationError(["pick a schedule for this bill"]);
            const due_ms = (_c = item.next_due_ms) !== null && _c !== void 0 ? _c : now_ms;
            const converted = await (0, convert_transaction_to_recurring_orchestrator_1.convert_transaction_to_recurring_orchestrator)(ctx, user_id, {
                transaction_id: latest.id,
                name: (_d = input.name) !== null && _d !== void 0 ? _d : item.name,
                amount: (_e = input.amount) !== null && _e !== void 0 ? _e : item.amount,
                frequency: freq,
                next_due_date: (_f = input.next_due_date) !== null && _f !== void 0 ? _f : new Date(due_ms).toISOString().slice(0, 10),
                link_past: true,
                review_item_id: item.id,
            }, now_ms);
            (0, observability_1.log_operation_success)(span, user_id);
            const made = { record_id: converted.id, direction: converted.direction };
            if (converted.in_progress)
                return Object.assign({ item_id: input.item_id, status: "open", answer: "converted", no_op: false, in_progress: true }, made);
            return Object.assign({ item_id: input.item_id, status: "resolved", answer: "converted", no_op: false }, made);
        }
        // 2c. "Same bill" (D7 / D22): the old bill ends after its last payment and is merged into the
        //     new stream's bill (kept active, out of the Removed list, undoable). One stamped write +
        //     the stored periods follow + ONE coalesced re-assign of its account.
        if (plan.merge) {
            const old_id = plan.merge.old_record_id;
            const repo = context.item.direction === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo;
            const old = await repo.get_by_id(ctx, old_id, { include_deleted: true });
            if (old && old.user_id === user_id) {
                const month_start = Date.UTC(new Date(now_ms).getUTCFullYear(), new Date(now_ms).getUTCMonth(), 1);
                const mp = (0, merge_service_1.plan_merge_old_into_new)({
                    id: old.id, removal_intervals: old.removal_intervals, user_custom_name: old.user_custom_name,
                    expected_amount_override: old.expected_amount_override, user_frequency: (_g = old.user_frequency) !== null && _g !== void 0 ? _g : null,
                    last_payment_ms: await (0, last_payment_resolver_1.resolve_last_payment_ms)(ctx, user_id, context.item.direction, old.id, (_k = (_j = (_h = old.last_date) === null || _h === void 0 ? void 0 : _h.toMillis) === null || _j === void 0 ? void 0 : _j.call(_h)) !== null && _k !== void 0 ? _k : null),
                    merged_into_id: old.merged_into_id, is_active: old.is_active,
                }, plan.merge.into_stream_id, now_ms, month_start);
                if (mp) {
                    await repo.apply_merge(ctx, old_id, { intervals: mp.intervals, merged_into_id: plan.merge.into_stream_id, merge_log: mp.merge_log }, `merge_${ctx.trace_id}`);
                    await repo.apply_period_suppression(ctx, old_id, mp.intervals, user_id);
                    await (0, reassign_user_orchestrator_1.enqueue_reassign_user)({
                        user_id,
                        reason: "recurring_removal",
                        scope: Object.assign(Object.assign({}, (old.account_id ? { account_ids: [old.account_id] } : {})), { from_ms: Math.min(month_start, mp.intervals[mp.intervals.length - 1].from_ms) }),
                    }, ctx.trace_id).catch((e) => console.error(`[${ctx.trace_id}] merge re-assign enqueue failed:`, e));
                    await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
                }
            }
        }
        // 3. Record action first (so a failure leaves the question open, to be answered again).
        const item = context.item;
        if (plan.record_action === "ack_still_a_bill" && item.record_id) {
            const repo = item.direction === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo;
            await repo.set_plaid_inactive_ack(ctx, item.record_id, now_ms, user_id);
        }
        else if (plan.record_action === "end" && item.record_id) {
            await (0, manage_recurring_removal_orchestrator_1.manage_recurring_removal_orchestrator)(ctx, user_id, [], { id: item.record_id, action: "end" }, now_ms, item.direction === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo, item.direction === "outflow" ? "recurring_outflow" : "recurring_inflow");
        }
        // 4. The item + the review state.
        await recurring_review_repo_1.recurring_review_repo.upsert_items(ctx, [plan.item]);
        if ((0, review_item_service_1.apply_review_state_change)(context.state, user_id, plan.state_change).changed) {
            // Atomic against the fresh doc (a concurrent sync / detector write is never lost).
            const next = await recurring_review_repo_1.recurring_review_repo.apply_state_change(ctx, user_id, plan.state_change);
            if (next.suppressed_changed)
                await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
        }
        // 5. "Track" / "keep separate": re-sync the item now so the bill exists right away.
        if (plan.resync_item_doc_id) {
            try {
                await (0, sync_item_orchestrator_1.enqueue_item_sync)({
                    item_doc_id: plan.resync_item_doc_id,
                    user_id,
                    recurring: true,
                    reason: `review_${input.answer}`,
                    trace_id: ctx.trace_id,
                });
            }
            catch (error) {
                // The new bill can't be made: the answer is undone — the item back to open and its pending
                // track removed (a later sync must not create a bill from it) — and a "same bill" merge
                // written above must not strand the old one.
                let rolled_back = false;
                try {
                    const undone = await recurring_review_repo_1.recurring_review_repo.rollback_answer(ctx, user_id, { answered: plan.item, original: context.item });
                    rolled_back = undone.rolled_back;
                    if (undone.rolled_back)
                        await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
                }
                catch (rollback_error) {
                    console.error(`[${ctx.trace_id}] review answer rollback failed:`, rollback_error);
                }
                // The merge is undone only with the answer: a racing sync that consumed the track owns it now.
                if (plan.merge && rolled_back) {
                    const repo = context.item.direction === "outflow" ? repositories_1.outflow_repo : repositories_1.inflow_repo;
                    const old = await repo.get_by_id(ctx, plan.merge.old_record_id, { include_deleted: true });
                    const log = old === null || old === void 0 ? void 0 : old.merge_log;
                    if (old && log) {
                        await repo.clear_merge(ctx, old.id, log.prior_intervals, `merge_rollback_${ctx.trace_id}`, log.prior_is_active);
                        await repo.apply_period_suppression(ctx, old.id, log.prior_intervals, user_id);
                        await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
                    }
                }
                throw error;
            }
        }
        (0, observability_1.log_operation_success)(span, user_id);
        // A tracked Plaid suggestion's bill / income takes the stream's id (D48: the app tags it NEW).
        const tracked = input.answer === "track" && context.item.stream_id
            ? { record_id: context.item.stream_id, direction: context.item.direction }
            : {};
        return Object.assign({ item_id: input.item_id, status: plan.item.status, answer: input.answer, no_op: false }, tracked);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=answer_recurring_review_item.orchestrator.js.map