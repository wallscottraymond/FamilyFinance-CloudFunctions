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
/** Start of the current month (UTC) — the `from` boundary for going-forward / pause. */
function month_start_utc(now_ms) {
    const d = new Date(now_ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
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
            await repo.hard_delete(ctx, input.id, user_id);
            (0, observability_1.log_operation_success)(span, user_id);
            return { id: input.id, action: "delete", deleted: true, state: null };
        }
        // 4. Apply the pure suppression transition.
        const month_start_ms = month_start_utc(now_ms);
        let next;
        if (input.action === "remove") {
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
        // 5. Persist.
        await repo.set_removal_intervals(ctx, input.id, next, has_open_interval(next), user_id);
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