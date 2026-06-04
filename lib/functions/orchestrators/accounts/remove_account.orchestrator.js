"use strict";
/**
 * Remove Account Orchestrator
 *
 * Coordinates soft-deletion of an account with two-tier removal logic:
 * - Single Account Removal: Local soft-delete only (Plaid item stays active)
 * - Full Item Removal: Call Plaid API + soft-delete (last account for item)
 *
 * Includes idempotency handling, permission checks, cascade job scheduling,
 * and event emission.
 *
 * @module orchestrators/accounts/remove_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.remove_account_orchestrator = remove_account_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const domain_1 = require("../../domain");
const resolvers_1 = require("../../resolvers");
const events_1 = require("../../events");
const plaid_1 = require("../../integrations/plaid");
const plaid_item_repo_1 = require("../../repositories/plaid/plaid_item.repo");
const encryption_1 = require("../../../utils/encryption");
const job_queue_1 = require("../../infrastructure/job_queue");
/**
 * Performance budget for remove_account.
 */
const BUDGET = {
    max_reads: 15, // Increased for resolver reads
    max_writes: 5,
    max_time_ms: 2000, // Increased to allow for Plaid API call
};
/**
 * Orchestrates soft-deletion of an account with two-tier removal logic.
 *
 * Flow (per architecture):
 * 1. Create span, log start
 * 2. Idempotency check
 * 3. Claim idempotency key
 * 4. Repository read (get account)
 * 5. Domain service (permission check)
 * 6. Resolver (dependency analysis - determines removal type)
 * 7. Domain service (compute removal state)
 * 8. Integration client (Plaid API - only for full item removal)
 * 9. Repository write (soft delete)
 * 10. Complete idempotency key
 * 11. Emit domain event
 * 12. Enqueue cascade jobs (transactions, recurring items)
 * 13. Log success, async debug
 *
 * @param ctx - Trace context
 * @param user_id - User performing the deletion
 * @param input - Remove account input
 * @param user_group_ids - User's group memberships
 * @returns Remove result
 */
async function remove_account_orchestrator(ctx, user_id, input, user_group_ids = []) {
    var _a, _b, _c, _d;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "remove_account");
    const perf = (0, types_1.create_performance_metrics)();
    const events = (0, events_1.create_event_emitter)(ctx.trace_id, span.span_id, user_id);
    (0, observability_1.log_operation_start)(span, user_id);
    let key_claimed = false;
    let dependencies = null;
    try {
        // 1. Idempotency check
        const idempotency_result = await (0, idempotency_store_1.check_idempotency)(ctx, input.idempotency_key);
        perf.reads++;
        if (idempotency_result.is_duplicate) {
            if (idempotency_result.status === "completed") {
                (0, observability_1.log_idempotent_return)(span, user_id);
                // Return cached result with default values for new fields
                return {
                    success: true,
                    account_id: input.account_id,
                    was_idempotent: true,
                    removal_type: "single_account",
                    transaction_count: 0,
                    outflow_count: 0,
                    inflow_count: 0,
                    cascade_jobs_enqueued: false,
                };
            }
            if (idempotency_result.status === "in_progress") {
                throw new Error("Request already in progress");
            }
            // If status is "failed", treat as new request (allow retry)
        }
        // 2. Claim the idempotency key before processing
        const claimed = await (0, idempotency_store_1.claim_key)(ctx, input.idempotency_key);
        perf.writes++;
        if (!claimed) {
            throw new Error("Request already in progress");
        }
        key_claimed = true;
        // 3. Repository read: Get the account
        const account = await repositories_1.account_repo.get_by_id(ctx, input.account_id);
        perf.reads++;
        if (!account) {
            throw new types_1.NotFoundError("account", input.account_id);
        }
        // 4. Domain service: Permission check (PURE - no IO)
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
        const access_result = (0, domain_1.check_account_delete_access)(access_data, user_context);
        if (!((_a = access_result.entity) === null || _a === void 0 ? void 0 : _a.has_access)) {
            if ((_b = access_result.validation_errors) === null || _b === void 0 ? void 0 : _b.length) {
                throw new types_1.PermissionDeniedError("remove_account", input.account_id);
            }
        }
        // 5. Domain service: Check if already deleted (idempotent case)
        if ((0, domain_1.is_account_already_deleted)(access_data)) {
            (0, observability_1.log_idempotent_return)(span, user_id);
            const result = { success: true, account_id: input.account_id };
            await (0, idempotency_store_1.complete_key)(ctx, input.idempotency_key, result);
            perf.writes++;
            return {
                success: true,
                account_id: input.account_id,
                was_idempotent: true,
                removal_type: "single_account",
                transaction_count: 0,
                outflow_count: 0,
                inflow_count: 0,
                cascade_jobs_enqueued: false,
            };
        }
        // 6. Resolver: Dependency analysis (what else is affected?)
        // This also determines if this is a single account or full item removal
        dependencies = await (0, resolvers_1.resolve_account_removal_dependencies)(ctx, input.account_id, user_id);
        // Note: Resolver reads are tracked internally
        // 7. Domain service: Determine removal type (PURE - no IO)
        const removal_type_result = (0, domain_1.determine_removal_type)({
            account_id: input.account_id,
            item_id: dependencies.item_id,
            other_active_accounts_count: dependencies.other_active_accounts_count,
        });
        if ((_c = removal_type_result.validation_errors) === null || _c === void 0 ? void 0 : _c.length) {
            throw new Error(removal_type_result.validation_errors.join("; "));
        }
        const { removal_type, should_call_plaid, reason } = removal_type_result.entity;
        console.log(`[${ctx.trace_id}] remove_account: type=${removal_type}, ` +
            `call_plaid=${should_call_plaid}, reason="${reason}"`);
        // 8. Domain service: Compute removal state (PURE - no IO)
        const removal_result = (0, domain_1.compute_account_removal)({
            account_id: input.account_id,
            account_user_id: account.user_id,
            item_id: dependencies.item_id || null,
            removal_mode: input.removal_mode,
            removal_type,
            now: new Date(),
        });
        if ((_d = removal_result.validation_errors) === null || _d === void 0 ? void 0 : _d.length) {
            throw new Error(removal_result.validation_errors.join("; "));
        }
        const removal_actions = removal_result.entity;
        // 9. Integration client: Call Plaid API (only for full item removal)
        let plaid_removal_success = true;
        if (removal_actions.should_remove_plaid_item && dependencies.item_id) {
            try {
                // Get the plaid item to retrieve the encrypted access token
                const plaid_item = await plaid_item_repo_1.plaid_item_repo.get_by_id(ctx, dependencies.item_id);
                perf.reads++;
                if (plaid_item && plaid_item.access_token) {
                    // Decrypt the access token
                    const access_token = (0, encryption_1.decryptAccessToken)(plaid_item.access_token);
                    const plaid_result = await (0, plaid_1.remove_item)(access_token);
                    console.log(`[${ctx.trace_id}] Plaid itemRemove: success=${plaid_result.success}, ` +
                        `already_removed=${plaid_result.already_removed}, request_id=${plaid_result.request_id}`);
                    plaid_removal_success = plaid_result.success;
                    // Also soft-delete the plaid item document
                    if (plaid_removal_success) {
                        await plaid_item_repo_1.plaid_item_repo.soft_delete(ctx, dependencies.item_id, user_id);
                        perf.writes++;
                    }
                }
                else {
                    console.warn(`[${ctx.trace_id}] No access token found for item ${dependencies.item_id}, ` +
                        `skipping Plaid API call`);
                }
            }
            catch (plaid_error) {
                // Log but continue - still soft-delete locally
                // TODO: Enqueue background job to retry Plaid cleanup
                console.error(`[${ctx.trace_id}] Plaid itemRemove failed, continuing with local soft-delete:`, plaid_error);
                plaid_removal_success = false;
            }
        }
        // Check performance budget before write
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget warning for remove_account`);
            // Continue anyway - completion is more important
        }
        // 10. Repository write: Soft delete the account (audit is automatic)
        await repositories_1.account_repo.soft_delete(ctx, input.account_id, user_id);
        perf.writes++;
        // 11. Complete idempotency key
        const result = { success: true, account_id: input.account_id };
        await (0, idempotency_store_1.complete_key)(ctx, input.idempotency_key, result);
        perf.writes++;
        (0, observability_1.log_operation_success)(span, user_id);
        // 12. Emit domain event (fire-and-forget)
        const event_payload = {
            account_id: input.account_id,
            user_id,
            removed_at: firestore_1.Timestamp.now(),
        };
        events.emit(events_1.ACCOUNT_EVENTS.REMOVED, event_payload);
        // 13. Enqueue cascade jobs (if needed)
        let cascade_jobs_enqueued = false;
        if (dependencies.recomputation_scope !== "none") {
            console.log(`[${ctx.trace_id}] Enqueuing cascade jobs: ` +
                `transactions=${dependencies.transaction_count}, ` +
                `outflows=${dependencies.outflow_ids.length}, ` +
                `inflows=${dependencies.inflow_ids.length}`);
            // Enqueue transaction hiding job if there are transactions
            if (dependencies.transaction_count > 0) {
                const hide_transactions_payload = {
                    plaid_account_id: account.account_id,
                    user_id,
                    removal_mode: input.removal_mode,
                    trace_id: ctx.trace_id,
                };
                await (0, job_queue_1.create_job)("cascade_hide_transactions", hide_transactions_payload, { trace_id: ctx.trace_id });
                cascade_jobs_enqueued = true;
            }
            // Enqueue recurring items soft-delete job if there are outflows or inflows
            if (dependencies.outflow_ids.length > 0 || dependencies.inflow_ids.length > 0) {
                const soft_delete_recurring_payload = {
                    plaid_account_id: account.account_id,
                    user_id,
                    outflow_ids: dependencies.outflow_ids,
                    inflow_ids: dependencies.inflow_ids,
                    trace_id: ctx.trace_id,
                };
                await (0, job_queue_1.create_job)("cascade_soft_delete_recurring", soft_delete_recurring_payload, { trace_id: ctx.trace_id });
                cascade_jobs_enqueued = true;
            }
            // TODO: Enqueue budget recalculation job if removal_mode === "delete_history"
            // TODO: Enqueue Plaid cleanup retry job if plaid_removal_success === false
        }
        // 14. Async debug logging
        (0, observability_1.fire_and_forget)(() => {
            var _a, _b, _c, _d;
            return (0, observability_1.log_async_debug)({
                trace_id: ctx.trace_id,
                span_id: span.span_id,
                layer: "orchestrator",
                function: "remove_account",
                status: "success",
                context: {
                    account_id: input.account_id,
                    removal_mode: input.removal_mode,
                    removal_type,
                    plaid_removal_success,
                    transaction_count: (_a = dependencies === null || dependencies === void 0 ? void 0 : dependencies.transaction_count) !== null && _a !== void 0 ? _a : 0,
                    outflow_count: (_b = dependencies === null || dependencies === void 0 ? void 0 : dependencies.outflow_ids.length) !== null && _b !== void 0 ? _b : 0,
                    inflow_count: (_c = dependencies === null || dependencies === void 0 ? void 0 : dependencies.inflow_ids.length) !== null && _c !== void 0 ? _c : 0,
                    recomputation_scope: (_d = dependencies === null || dependencies === void 0 ? void 0 : dependencies.recomputation_scope) !== null && _d !== void 0 ? _d : "none",
                    perf_reads: perf.reads,
                    perf_writes: perf.writes,
                },
            });
        });
        return {
            success: true,
            account_id: input.account_id,
            was_idempotent: false,
            removal_type,
            transaction_count: dependencies.transaction_count,
            outflow_count: dependencies.outflow_ids.length,
            inflow_count: dependencies.inflow_ids.length,
            cascade_jobs_enqueued,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "REMOVE_ACCOUNT_FAILED" });
        // Release the idempotency key on failure (if claimed)
        if (key_claimed) {
            try {
                await (0, idempotency_store_1.fail_key)(ctx, input.idempotency_key, error instanceof Error ? error.message : "Unknown error");
            }
            catch (fail_error) {
                // Log but don't throw - the original error is more important
                console.error("Failed to release idempotency key:", fail_error);
            }
        }
        throw error;
    }
}
//# sourceMappingURL=remove_account.orchestrator.js.map