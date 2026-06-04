"use strict";
/**
 * Create Update Link Token Orchestrator
 *
 * Coordinates update link token creation through all required layers.
 * Used for re-authentication when Plaid connections enter error states.
 *
 * @module orchestrators/plaid/create_update_link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_update_link_token_orchestrator = create_update_link_token_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const update_link_token_resolver_1 = require("../../resolvers/plaid/update_link_token.resolver");
const update_link_token_service_1 = require("../../domain/plaid/update_link_token.service");
const plaid_1 = require("../../integrations/plaid");
const firestore_1 = require("firebase-admin/firestore");
/**
 * Orchestrates update link token creation.
 *
 * Flow:
 * 1. Resolver: Gather dependencies (plaid item, access token, user profile)
 * 2. Domain Service: Validate request (ownership, status, eligibility)
 * 3. Integration Client: Call Plaid API in update mode
 * 4. Transformer: Convert to domain format
 * 5. Repository: Log relink attempt
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with link token or errors
 */
async function create_update_link_token_orchestrator(ctx) {
    var _a, _b, _c, _d, _e, _f, _g;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "create_update_link_token");
    const perf = (0, types_1.create_performance_metrics)();
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    try {
        // =========================================================================
        // 1. RESOLVER: Gather dependencies
        // =========================================================================
        const deps = await (0, update_link_token_resolver_1.resolve_update_link_token_dependencies)(ctx, {
            user_id: ctx.user_id,
            item_id: ctx.input.item_id,
        });
        perf.reads += 3; // item, user, relink_attempts
        // =========================================================================
        // 2. DOMAIN SERVICE: Validate request
        // =========================================================================
        const validation = (0, update_link_token_service_1.validate_update_link_token_request)({
            user_id: ctx.user_id,
            item_found: deps.item_found,
            user_owns_item: deps.user_owns_item,
            item_is_active: (_b = (_a = deps.plaid_item) === null || _a === void 0 ? void 0 : _a.is_active) !== null && _b !== void 0 ? _b : false,
            item_status: (_d = (_c = deps.plaid_item) === null || _c === void 0 ? void 0 : _c.status) !== null && _d !== void 0 ? _d : null,
            access_token_valid: deps.access_token !== null,
            recent_relink_attempts: deps.recent_relink_attempts,
        });
        if (!validation.is_valid) {
            (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
                user_id: ctx.user_id,
                error_code: "VALIDATION_FAILED",
                context: { errors: validation.errors },
            });
            return {
                success: false,
                errors: validation.errors,
                relink_disabled: validation.relink_disabled,
                disabled_reason: validation.disabled_reason || undefined,
            };
        }
        // Check for help message
        const help_info = (0, update_link_token_service_1.should_show_help_message)(deps.recent_relink_attempts);
        if (help_info.show_help) {
            console.log(`[${ctx.trace_id}] User ${ctx.user_id} has ${deps.recent_relink_attempts} ` +
                `recent relink attempts for item ${ctx.input.item_id}`);
        }
        // =========================================================================
        // 3. INTEGRATION CLIENT: Call Plaid API in update mode
        // =========================================================================
        const plaid_response = await (0, plaid_1.create_link_token)({
            user_id: ctx.user_id,
            user_name: deps.user_display_name,
            user_email: deps.user_email,
            access_token: deps.access_token, // Validated in domain service
        });
        // =========================================================================
        // 4. TRANSFORMER: Convert to domain format
        // =========================================================================
        const link_token_result = (0, plaid_1.transform_link_token_response)(plaid_response);
        // =========================================================================
        // 5. REPOSITORY: Log relink attempt
        // =========================================================================
        await log_relink_attempt(ctx, (_f = (_e = deps.plaid_item) === null || _e === void 0 ? void 0 : _e.error) !== null && _f !== void 0 ? _f : null);
        perf.writes++;
        // Check performance budget
        if ((0, types_1.is_budget_exceeded)(perf, types_1.CREATE_UPDATE_LINK_TOKEN_BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for create_update_link_token: ` +
                `reads=${perf.reads}, writes=${perf.writes}, time=${perf.time_ms}ms`);
        }
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => {
            var _a;
            return (0, observability_1.log_async_debug)({
                trace_id: ctx.trace_id,
                span_id: span.span_id,
                layer: "orchestrator",
                function: "create_update_link_token",
                status: "success",
                output: {
                    request_id: link_token_result.request_id,
                    item_id: ctx.input.item_id,
                    institution_name: (_a = deps.plaid_item) === null || _a === void 0 ? void 0 : _a.institution_name,
                },
                context: {
                    perf_reads: perf.reads,
                    perf_writes: perf.writes,
                    recent_relink_attempts: deps.recent_relink_attempts,
                },
            });
        });
        return {
            success: true,
            data: {
                link_token: link_token_result.link_token,
                expiration: link_token_result.expiration,
                institution_name: ((_g = deps.plaid_item) === null || _g === void 0 ? void 0 : _g.institution_name) || "Your Bank",
                request_id: link_token_result.request_id,
            },
        };
    }
    catch (error) {
        // Log the full error for debugging
        console.error("[create_update_link_token_orchestrator] Error:", error);
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: ctx.user_id, error_code: "CREATE_UPDATE_LINK_TOKEN_FAILED" });
        // Return generic error message (per project decisions)
        return {
            success: false,
            errors: ["Unable to prepare reconnection. Please try again later."],
        };
    }
}
/**
 * Logs a relink attempt to Firestore for tracking.
 *
 * @param ctx - Orchestrator context
 * @param error_code - Error code that triggered the relink
 */
async function log_relink_attempt(ctx, error_code) {
    try {
        const db = (0, firestore_1.getFirestore)();
        const attempt_ref = db.collection("relink_attempts").doc();
        await attempt_ref.set({
            id: attempt_ref.id,
            user_id: ctx.user_id,
            item_id: ctx.input.item_id,
            error_code,
            trace_id: ctx.trace_id,
            success: null, // Will be updated when relink completes
            created_at: firestore_1.Timestamp.now(),
            completed_at: null,
        });
    }
    catch (error) {
        // Log but don't fail the main operation
        console.error(`[${ctx.trace_id}] Failed to log relink attempt:`, error);
    }
}
//# sourceMappingURL=create_update_link_token.orchestrator.js.map