"use strict";
/**
 * Get Accounts Orchestrator
 *
 * Coordinates retrieval of user accounts.
 * This is a read-only operation - no idempotency or events needed.
 *
 * @module orchestrators/accounts/get_accounts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_accounts_orchestrator = get_accounts_orchestrator;
exports.get_account_orchestrator = get_account_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
const domain_1 = require("../../domain");
/**
 * Performance budget for get_accounts.
 * Read-only operations have higher read limits.
 */
const BUDGET = {
    max_reads: 50,
    max_writes: 0,
    max_time_ms: 300,
};
/**
 * Orchestrates retrieval of user accounts.
 *
 * Flow:
 * 1. Log start
 * 2. Repository read (no idempotency for reads)
 * 3. Log success
 * 4. Async debug logging
 *
 * @param ctx - Trace context
 * @param user_id - User ID
 * @param input - Optional filters
 * @returns User's accounts
 */
async function get_accounts_orchestrator(ctx, user_id, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "get_accounts");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // Read-only: No idempotency check needed
        // Read-only: No resolver needed (not modifying anything)
        // Read-only: No domain service needed (just fetching)
        // Fetch accounts from repository
        const accounts = await repositories_1.account_repo.get_by_user_id(ctx, user_id, {
            include_deleted: input === null || input === void 0 ? void 0 : input.include_inactive,
        });
        perf.reads++;
        // Check performance budget
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            // For reads, we just log a warning - don't fail
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for get_accounts`);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        // Read-only: No events needed
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "get_accounts",
            status: "success",
            output: { count: accounts.length },
            context: { perf_reads: perf.reads },
        }));
        return {
            accounts,
            count: accounts.length,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "GET_ACCOUNTS_FAILED" });
        throw error;
    }
}
/**
 * Gets a single account by ID with permission check.
 *
 * Flow:
 * 1. Log start
 * 2. Repository read
 * 3. Domain service permission check
 * 4. Log success
 *
 * @param ctx - Trace context
 * @param user_id - User ID (for permission check)
 * @param account_id - Account ID
 * @param user_group_ids - User's group memberships (for group access)
 * @returns Account or null if not found/not authorized
 */
async function get_account_orchestrator(ctx, user_id, account_id, user_group_ids = []) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "get_account");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 1. Repository read
        const account = await repositories_1.account_repo.get_by_id(ctx, account_id);
        perf.reads++;
        if (!account) {
            (0, observability_1.log_operation_success)(span, user_id);
            return null;
        }
        // 2. Domain service: Permission check (PURE - no IO)
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
        const access_result = (0, domain_1.check_account_read_access)(access_data, user_context);
        if (!((_a = access_result.entity) === null || _a === void 0 ? void 0 : _a.has_access)) {
            (0, observability_1.log_operation_error)(span, new Error("Permission denied"), {
                user_id,
                error_code: "PERMISSION_DENIED",
                context: { reason: (_b = access_result.entity) === null || _b === void 0 ? void 0 : _b.reason },
            });
            return null;
        }
        (0, observability_1.log_operation_success)(span, user_id);
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => {
            var _a;
            return (0, observability_1.log_async_debug)({
                trace_id: ctx.trace_id,
                span_id: span.span_id,
                layer: "orchestrator",
                function: "get_account",
                status: "success",
                context: {
                    account_id,
                    access_reason: (_a = access_result.entity) === null || _a === void 0 ? void 0 : _a.reason,
                },
            });
        });
        return account;
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "GET_ACCOUNT_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=get_accounts.orchestrator.js.map