"use strict";
/**
 * Manage Recurring Removal Orchestrator (generic over outflow/inflow)
 *
 * Coordinates the Remove-Recover-Recurring actions on a recurring item: remove
 * (all / going-forward), pause (until a date), restore (forward-only resume), and
 * permanent delete. Loads current state (resolver), authorizes, applies the pure
 * suppression transition (domain), and persists (repo). Repo-agnostic so outflows
 * and inflows share it. Suppression itself is derived on read elsewhere.
 *
 * @module orchestrators/recurring/manage_recurring_removal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.manage_recurring_removal_orchestrator = manage_recurring_removal_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const recurring_removal_resolver_1 = require("../../resolvers/recurring/recurring_removal.resolver");
const recurring_suppression_service_1 = require("../../domain/recurring/recurring_suppression.service");
const reassign_user_orchestrator_1 = require("../transactions/reassign_user.orchestrator");
const converted_delete_1 = require("./converted_delete");
/** Start of the current month (UTC) — the `from` boundary for going-forward / pause. */
function month_start_utc(now_ms) {
    const d = new Date(now_ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}
/**
 * The item's payments in the months whose suppression changed are released to budgets (or taken
 * back): re-assign that account's transactions from `from_ms` (undefined = all history), so the
 * stored budget spend / links follow — the period page applies the same rule on read.
 */
async function reassign_released_payments(ctx, context, from_ms) {
    await (0, reassign_user_orchestrator_1.enqueue_reassign_user)({
        user_id: context.owner_id,
        reason: "recurring_removal",
        scope: Object.assign(Object.assign({}, (context.account_id ? { account_ids: [context.account_id] } : {})), (from_ms !== undefined && from_ms > 0 ? { from_ms } : {})),
    }, ctx.trace_id).catch((error) => console.error(`[${ctx.trace_id}] recurring re-assign enqueue failed:`, error));
}
/** `removedByUser` denorm = the item has an open (indefinite) removal interval. */
function has_open_interval(intervals) {
    return intervals.some((i) => i.to_ms === null);
}
async function manage_recurring_removal_orchestrator(ctx, user_id, user_group_ids, input, now_ms, repo, entity_kind) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "manage_recurring_removal");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 1. Load current state.
        const context = await (0, recurring_removal_resolver_1.resolve_recurring_removal_context)(ctx, repo, input.id);
        if (!context) {
            throw new types_1.NotFoundError(entity_kind, input.id);
        }
        // 2. Authorize: the owner, or a member of a group the item is shared with.
        // (Group membership arrives empty until RBAC-Migration wires user group
        // lookup — effectively owner-only for now.)
        const is_owner = context.owner_id === user_id;
        const is_member = context.group_ids.some((g) => user_group_ids.includes(g));
        if (!is_owner && !is_member) {
            throw new types_1.PermissionDeniedError("manage_recurring", input.id);
        }
        // 3. Permanent delete is a distinct hard-delete path (no interval math).
        if (input.action === "delete") {
            // Others may depend on it: merged-into records are un-merged, absorbed streams remembered.
            await (0, converted_delete_1.handle_converted_delete)(ctx, user_id, entity_kind === "recurring_outflow" ? "outflow" : "inflow", input.id);
            // Its periods first: one left behind is still a match candidate (it pulls payments back to
            // the deleted id) and still shows in the summaries. A failure leaves the record to delete again.
            await repo.delete_periods(ctx, input.id, user_id);
            await repo.hard_delete(ctx, input.id, user_id);
            // …and again after: a convert retry already past its read may have generated periods in
            // between (no lease guards Delete). With the doc gone, nothing generates them again.
            await repo.delete_periods(ctx, input.id, user_id);
            await reassign_released_payments(ctx, context, undefined); // its links go everywhere
            (0, observability_1.log_operation_success)(span, user_id);
            return { id: input.id, action: "delete", deleted: true, state: null };
        }
        // 3b. A bill merged into another can't be restored from the Removed list (it would count
        //     twice next to the bill it was merged into — X4 / D23); the merge is undone instead.
        if (input.action === "restore" && context.merged_into_id) {
            throw new types_1.ValidationError(["this bill was merged into another — undo the merge instead"]);
        }
        // 4. Apply the pure suppression transition.
        const month_start_ms = month_start_utc(now_ms);
        let next;
        if (input.action === "end") {
            next = (0, recurring_suppression_service_1.apply_end_at)(context.removal_intervals, context.last_payment_ms, now_ms, month_start_ms);
            // Already ended by a removal in effect (defect 5): nothing to write, nothing to release.
            if (next === context.removal_intervals) {
                (0, observability_1.log_operation_success)(span, user_id);
                return { id: input.id, action: input.action, deleted: false, state: (0, recurring_suppression_service_1.current_removal_state)(next, now_ms) };
            }
        }
        else if (input.action === "remove") {
            next = (0, recurring_suppression_service_1.apply_remove)(context.removal_intervals, input.mode, now_ms, month_start_ms);
        }
        else if (input.action === "pause") {
            if (input.resume_ms <= now_ms) {
                throw new types_1.ValidationError(["resume date must be in the future"]);
            }
            next = (0, recurring_suppression_service_1.apply_pause)(context.removal_intervals, input.resume_ms, now_ms, month_start_ms);
        }
        else {
            next = (0, recurring_suppression_service_1.apply_restore)(context.removal_intervals, now_ms);
        }
        // 5. Persist the durable intervals on the definition, THEN reflect them onto the
        // materialized periods (flip isActive) so the change shows in the summaries-backed
        // list + totals — not just the derive path. Covers remove / pause / restore alike.
        await repo.set_removal_intervals(ctx, input.id, next, has_open_interval(next), user_id);
        await repo.apply_period_suppression(ctx, input.id, next, user_id);
        // Only months from now on change — except "remove all", which reaches back to the start, and
        // an end, which starts the month after the last payment (possibly earlier than this month).
        const released_from = input.action === "remove" && input.mode === "all"
            ? undefined
            : input.action === "end"
                ? Math.min(month_start_ms, next[next.length - 1].from_ms)
                : month_start_ms;
        await reassign_released_payments(ctx, context, released_from);
        (0, observability_1.log_operation_success)(span, user_id);
        return {
            id: input.id,
            action: input.action,
            deleted: false,
            state: (0, recurring_suppression_service_1.current_removal_state)(next, now_ms),
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=manage_recurring_removal.orchestrator.js.map