"use strict";
/**
 * Handle Login Repaired Orchestrator
 *
 * Processes ITEM.LOGIN_REPAIRED webhooks.
 * Clears error state, updates status to healthy, and triggers data refresh.
 *
 * @module orchestrators/plaid/handle_login_repaired
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handle_login_repaired_orchestrator = handle_login_repaired_orchestrator;
const types_1 = require("../../types");
const item_status_webhook_types_1 = require("../../types/plaid/item_status_webhook.types");
const observability_1 = require("../../observability");
const item_status_webhook_resolver_1 = require("../../resolvers/plaid/item_status_webhook.resolver");
const item_status_webhook_service_1 = require("../../domain/plaid/item_status_webhook.service");
const reauth_recovery_orchestrator_1 = require("./reauth_recovery.orchestrator");
/**
 * Orchestrates handling of ITEM.LOGIN_REPAIRED webhooks.
 *
 * Flow:
 * 1. Resolver: Find item by Plaid item ID
 * 2. Domain Service: Compute status update (clear error)
 * 3. Repository: Clear error state + mark relink attempts successful
 * 4. (Optional) Trigger a full data refresh
 *
 * @param ctx - Orchestrator context with webhook input
 * @returns Response indicating success/failure
 */
async function handle_login_repaired_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "handle_login_repaired");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    try {
        // =========================================================================
        // 1. RESOLVER: Find item by Plaid item ID
        // =========================================================================
        const deps = await (0, item_status_webhook_resolver_1.resolve_item_status_webhook_dependencies)(ctx, {
            plaid_item_id: ctx.input.plaid_item_id,
        });
        perf.reads++;
        if (!deps.item_found || !deps.item_doc_id || !deps.user_id) {
            console.warn(`[${ctx.trace_id}] Item not found for Plaid item ID: ${ctx.input.plaid_item_id}`);
            return {
                success: false,
                skipped: true,
                skip_reason: "Item not found",
            };
        }
        // =========================================================================
        // 2. DOMAIN SERVICE: Compute status update (clear error)
        // =========================================================================
        const status_update = (0, item_status_webhook_service_1.compute_login_repaired_update)();
        const trigger_refresh = (0, item_status_webhook_service_1.should_trigger_refresh)(deps.current_status, status_update.status);
        // =========================================================================
        // 3. REPOSITORY: Clear error state + close open relink attempts
        // =========================================================================
        const target = {
            item_doc_id: deps.item_doc_id,
            plaid_item_id: ctx.input.plaid_item_id,
            user_id: deps.user_id,
        };
        await (0, reauth_recovery_orchestrator_1.mark_item_repaired)(ctx, target);
        perf.writes++;
        // =========================================================================
        // 4. TRIGGER DATA REFRESH (if coming from error state)
        // =========================================================================
        // Full refresh — balances, transactions and recurring — since syncs skipped
        // this item while it was broken. Fire and forget so the webhook answers fast;
        // the scheduled syncs are the backstop if this is cut short.
        let refresh_triggered = false;
        if (trigger_refresh) {
            console.log(`[${ctx.trace_id}] Triggering data refresh after login repair for item ${deps.item_doc_id}`);
            (0, observability_1.fire_and_forget)(async () => {
                await (0, reauth_recovery_orchestrator_1.refresh_repaired_item)(ctx, target);
            });
            refresh_triggered = true;
        }
        // Check performance budget
        if ((0, types_1.is_budget_exceeded)(perf, item_status_webhook_types_1.ITEM_STATUS_WEBHOOK_BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for handle_login_repaired`);
        }
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "handle_login_repaired",
            status: "success",
            output: {
                item_doc_id: deps.item_doc_id,
                previous_status: deps.current_status,
                new_status: status_update.status,
                refresh_triggered,
            },
            context: {
                institution_name: deps.institution_name,
            },
        }));
        return {
            success: true,
            skipped: false,
            item_doc_id: deps.item_doc_id,
            previous_status: deps.current_status || undefined,
            new_status: status_update.status,
            refresh_triggered,
        };
    }
    catch (error) {
        console.error("[handle_login_repaired_orchestrator] Error:", error);
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: ctx.user_id, error_code: "HANDLE_LOGIN_REPAIRED_FAILED" });
        return {
            success: false,
            skipped: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
//# sourceMappingURL=handle_login_repaired.orchestrator.js.map