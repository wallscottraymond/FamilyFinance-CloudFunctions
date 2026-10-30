"use strict";
/**
 * Set Occurrence Settled Orchestrator ("Mark as paid" / "Mark as received")
 *
 * Marks ONE occurrence of a bill / income settled by hand — a payment made in cash / Venmo / from
 * an account that isn't linked, so no transaction will ever arrive — or clears the mark. The mark
 * is durable user state on the DEFINITION (`manualSettledOccurrences[<due date>]`); the period
 * page and the stored reconcile both apply it on read through one rule
 * (domain/recurring/manual_settlement — a real payment always wins).
 *
 * Flow: resolve (item + expected-amount inputs) → authorize (owner or group member) → validate
 * the due date is an occurrence of the item → transactional write (repo) → bump the derive
 * version AFTER the write (derive caches live 24h) → enqueue the item's stored reconcile.
 *
 * @module orchestrators/recurring/set_occurrence_settled
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_occurrence_settled_orchestrator = set_occurrence_settled_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const occurrence_settlement_resolver_1 = require("../../resolvers/recurring/occurrence_settlement.resolver");
const expected_occurrences_service_1 = require("../../domain/recurring/expected_occurrences.service");
const manual_settlement_service_1 = require("../../domain/recurring/manual_settlement.service");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const coalesced_jobs_1 = require("../../infrastructure/coalesced_jobs");
const round2 = (n) => Math.round(n * 100) / 100;
/** The UTC calendar month containing `ms` (the monthly home period the page expects from). */
function utc_month(ms) {
    const d = new Date(ms);
    const start_ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const end_ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - 1;
    return { start_ms, end_ms };
}
async function set_occurrence_settled_orchestrator(ctx, user_id, user_group_ids, input) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "set_occurrence_settled");
    (0, observability_1.log_operation_start)(span, user_id);
    const entity_kind = input.kind === "outflow" ? "recurring_outflow" : "recurring_inflow";
    try {
        const due_ms = (0, manual_settlement_service_1.parse_occurrence_date_key)(input.due_date);
        if (due_ms === null) {
            throw new types_1.ValidationError(["due_date must be a calendar date (YYYY-MM-DD)"]);
        }
        if (input.amount !== undefined && (!Number.isFinite(input.amount) || input.amount < 0)) {
            throw new types_1.ValidationError(["amount must be a non-negative number"]);
        }
        // 1. Load the item (+ income history only when the amount defaults to the expected one).
        const needs_history = input.settled && input.amount === undefined;
        const context = await (0, occurrence_settlement_resolver_1.resolve_occurrence_settlement_context)(ctx, input.kind, input.recurring_id, needs_history);
        if (!context) {
            throw new types_1.NotFoundError(entity_kind, input.recurring_id);
        }
        // 2. Authorize: the owner, or a member of a group the item is shared with (same rule as
        // remove / pause — group membership arrives empty until RBAC-Migration wires the lookup).
        const is_owner = context.owner_id === user_id;
        const is_member = context.group_ids.some((g) => user_group_ids.includes(g));
        if (!is_owner && !is_member) {
            throw new types_1.PermissionDeniedError("set_occurrence_settled", input.recurring_id);
        }
        // 3. The due date must be an occurrence of the item. Expected amounts come from the
        // occurrence's monthly home period — the same rule (and window) the monthly page uses.
        const month = utc_month(due_ms);
        const occurrence = (0, expected_occurrences_service_1.build_expected_occurrences)(context.item, month.start_ms, month.end_ms).find((e) => (0, manual_settlement_service_1.occurrence_date_key)(e.due_date_ms) === input.due_date);
        // Clearing a mark the schedule has since moved away from is still allowed (cleanup).
        const clearing_stale = !input.settled && input.due_date in context.marks;
        if (!occurrence && !clearing_stale) {
            throw new types_1.ValidationError([`${input.due_date} is not an occurrence of this item`]);
        }
        // 4. Transactional write of the mark (or its removal).
        const amount = input.settled ? round2((_b = (_a = input.amount) !== null && _a !== void 0 ? _a : occurrence === null || occurrence === void 0 ? void 0 : occurrence.amount_due) !== null && _b !== void 0 ? _b : 0) : null;
        const repo = input.kind === "outflow" ? outflow_repo_1.outflow_repo : inflow_repo_1.inflow_repo;
        await repo.set_manual_settlement(ctx, input.recurring_id, input.due_date, amount === null ? null : { amount, marked_by: user_id }, user_id);
        // 5. Invalidate the derive cache AFTER the write (derive caches live 24h), awaited so the
        // app's re-derive sees the new version. Owner's version: the item's data is theirs.
        await (0, derive_version_repo_1.bump_derive_version)(context.owner_id).catch(() => { });
        // 6. Stored periods follow via the item's (coalesced) reconcile.
        await (0, coalesced_jobs_1.enqueue_reconcile_recurring)({
            user_id: context.owner_id,
            recurring_id: input.recurring_id,
            recurring_type: input.kind,
            trace_id: ctx.trace_id,
        }).catch((error) => console.error(`[${ctx.trace_id}] set_occurrence_settled reconcile enqueue failed:`, error));
        (0, observability_1.log_operation_success)(span, user_id);
        return {
            kind: input.kind,
            recurring_id: input.recurring_id,
            due_date: input.due_date,
            settled: input.settled,
            amount,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=set_occurrence_settled.orchestrator.js.map