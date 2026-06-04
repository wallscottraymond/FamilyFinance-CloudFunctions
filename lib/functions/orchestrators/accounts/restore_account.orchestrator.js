"use strict";
/**
 * Restore Account Orchestrator
 *
 * Coordinates restoring a soft-deleted account.
 * Only accounts that were single-account removals (item still active) can be restored.
 *
 * @module orchestrators/accounts/restore_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.restore_account_orchestrator = restore_account_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const domain_1 = require("../../domain");
const events_1 = require("../../events");
const job_queue_1 = require("../../infrastructure/job_queue");
/**
 * Performance budget for restore_account.
 */
const BUDGET = {
    max_reads: 10,
    max_writes: 5,
    max_time_ms: 1000,
};
/**
 * Orchestrates restoring a soft-deleted account.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Repository read (get account)
 * 3. Domain service (permission + restore validation)
 * 4. Repository write (restore account)
 * 5. Enqueue restore jobs (if requested)
 * 6. Emit domain event
 *
 * @param ctx - Trace context
 * @param user_id - User performing the restore
 * @param input - Restore account input
 * @param user_group_ids - User's group memberships
 * @returns Restore result
 */
async function restore_account_orchestrator(ctx, user_id, input, user_group_ids = []) {
    var _a, _b, _c, _d;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "restore_account");
    const perf = (0, types_1.create_performance_metrics)();
    const events = (0, events_1.create_event_emitter)(ctx.trace_id, span.span_id, user_id);
    (0, observability_1.log_operation_start)(span, user_id);
    let key_claimed = false;
    try {
        // 1. Idempotency check
        const idempotency_result = await (0, idempotency_store_1.check_idempotency)(ctx, input.idempotency_key);
        perf.reads++;
        if (idempotency_result.is_duplicate) {
            if (idempotency_result.status === "completed") {
                (0, observability_1.log_idempotent_return)(span, user_id);
                return {
                    success: true,
                    account_id: input.account_id,
                    was_idempotent: true,
                    restore_jobs_enqueued: false,
                };
            }
            if (idempotency_result.status === "in_progress") {
                throw new Error("Request already in progress");
            }
        }
        // 2. Claim the idempotency key
        const claimed = await (0, idempotency_store_1.claim_key)(ctx, input.idempotency_key);
        perf.writes++;
        if (!claimed) {
            throw new Error("Request already in progress");
        }
        key_claimed = true;
        // 3. Repository read: Get the account (including deleted)
        const account = await repositories_1.account_repo.get_by_id(ctx, input.account_id, {
            include_deleted: true,
        });
        perf.reads++;
        if (!account) {
            throw new types_1.NotFoundError("account", input.account_id);
        }
        // 4. Domain service: Permission check
        const access_data = {
            user_id: account.user_id,
            is_active: account.is_active,
            is_deleted: account.is_deleted,
            access: account.access,
        };
        const user_context = {
            user_id,
            group_ids: user_group_ids,
        };
        const access_result = (0, domain_1.check_account_write_access)(access_data, user_context);
        if (!((_a = access_result.entity) === null || _a === void 0 ? void 0 : _a.has_access)) {
            throw new types_1.PermissionDeniedError("restore_account", input.account_id);
        }
        // 5. Check if already active (idempotent case)
        if (account.is_active) {
            (0, observability_1.log_idempotent_return)(span, user_id);
            const result = { success: true, account_id: input.account_id };
            await (0, idempotency_store_1.complete_key)(ctx, input.idempotency_key, result);
            perf.writes++;
            return {
                success: true,
                account_id: input.account_id,
                was_idempotent: true,
                restore_jobs_enqueued: false,
            };
        }
        // 6. Get the Plaid item to check if it's still active
        let item_is_active = null;
        if (account.item_id) {
            const plaid_item = await plaid_item_repo_1.plaid_item_repo.get_by_id(ctx, account.item_id);
            perf.reads++;
            item_is_active = (_b = plaid_item === null || plaid_item === void 0 ? void 0 : plaid_item.is_active) !== null && _b !== void 0 ? _b : false;
        }
        // 7. Domain service: Validate restore eligibility
        // For this, we need to know if the account was marked as restorable
        // We'll check if the item is still active as a proxy
        const restore_validation = (0, domain_1.validate_account_restore)(account.is_active, item_is_active !== false, // Assume restorable if item is active or null
        item_is_active);
        if (!((_c = restore_validation.entity) === null || _c === void 0 ? void 0 : _c.can_restore)) {
            throw new Error(((_d = restore_validation.entity) === null || _d === void 0 ? void 0 : _d.reason) || "Account cannot be restored");
        }
        // Check performance budget
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget warning for restore_account`);
        }
        // 8. Repository write: Restore the account
        await repositories_1.account_repo.restore(ctx, input.account_id, user_id);
        perf.writes++;
        // 9. Complete idempotency key
        const result = { success: true, account_id: input.account_id };
        await (0, idempotency_store_1.complete_key)(ctx, input.idempotency_key, result);
        perf.writes++;
        (0, observability_1.log_operation_success)(span, user_id);
        // 10. Enqueue restore jobs if requested
        let restore_jobs_enqueued = false;
        if (input.restore_transactions) {
            await (0, job_queue_1.create_job)("restore_account_transactions", {
                plaid_account_id: account.account_id,
                user_id,
                trace_id: ctx.trace_id,
            }, { trace_id: ctx.trace_id });
            restore_jobs_enqueued = true;
        }
        if (input.restore_recurring) {
            await (0, job_queue_1.create_job)("restore_account_recurring", {
                plaid_account_id: account.account_id,
                user_id,
                trace_id: ctx.trace_id,
            }, { trace_id: ctx.trace_id });
            restore_jobs_enqueued = true;
        }
        // 11. Emit domain event
        const event_payload = {
            account_id: input.account_id,
            user_id,
            restored_at: firestore_1.Timestamp.now(),
            restore_transactions: input.restore_transactions,
            restore_recurring: input.restore_recurring,
        };
        events.emit(events_1.ACCOUNT_EVENTS.RESTORED, event_payload);
        // 12. Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "restore_account",
            status: "success",
            context: {
                account_id: input.account_id,
                restore_transactions: input.restore_transactions,
                restore_recurring: input.restore_recurring,
                restore_jobs_enqueued,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        console.log(`[${ctx.trace_id}] restore_account: account=${input.account_id}, ` +
            `jobs_enqueued=${restore_jobs_enqueued}`);
        return {
            success: true,
            account_id: input.account_id,
            was_idempotent: false,
            restore_jobs_enqueued,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "RESTORE_ACCOUNT_FAILED" });
        if (key_claimed) {
            try {
                await (0, idempotency_store_1.fail_key)(ctx, input.idempotency_key, error instanceof Error ? error.message : "Unknown error");
            }
            catch (fail_error) {
                console.error("Failed to release idempotency key:", fail_error);
            }
        }
        throw error;
    }
}
//# sourceMappingURL=restore_account.orchestrator.js.map