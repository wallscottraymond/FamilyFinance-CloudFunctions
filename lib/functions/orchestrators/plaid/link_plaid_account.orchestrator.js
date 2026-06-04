"use strict";
/**
 * Link Plaid Account Orchestrator
 *
 * Coordinates the complete Plaid Link flow:
 * 1. Check idempotency
 * 2. Resolve dependencies
 * 3. Validate request (domain)
 * 4. Exchange public token for access token (integration)
 * 5. Validate Plaid item (domain)
 * 6. Save Plaid item (repository)
 * 7. Emit events
 *
 * Account syncing is handled by the onPlaidItemCreated trigger.
 *
 * @module orchestrators/plaid/link_plaid_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.link_plaid_account_orchestrator = link_plaid_account_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const plaid_1 = require("../../resolvers/plaid");
const plaid_2 = require("../../domain/plaid");
const plaid_3 = require("../../integrations/plaid");
const plaid_4 = require("../../repositories/plaid");
const events_1 = require("../../events");
const encryption_1 = require("../../../utils/encryption");
/**
 * Orchestrates the complete Plaid Link flow.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Resolver: Gather dependencies (user groups, duplicate check)
 * 3. Domain Service: Validate request
 * 4. Integration Client: Exchange public token for access token
 * 5. Domain Service: Validate Plaid item for creation
 * 6. Repository: Save Plaid item (with encrypted token)
 * 7. Emit events
 *
 * Note: Account syncing is handled by the onPlaidItemCreated trigger.
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with item data
 */
async function link_plaid_account_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "link_plaid_account");
    const perf = (0, types_1.create_performance_metrics)();
    const events = (0, events_1.create_event_emitter)(ctx.trace_id, span.span_id, ctx.user_id);
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    let key_claimed = false;
    try {
        // =========================================================================
        // 1. IDEMPOTENCY CHECK
        // =========================================================================
        const idempotency_result = await (0, idempotency_store_1.check_idempotency)(ctx, ctx.idempotency_key);
        perf.reads++;
        if (idempotency_result.is_duplicate) {
            if (idempotency_result.status === "completed") {
                (0, observability_1.log_idempotent_return)(span, ctx.user_id);
                return idempotency_result.cached_result;
            }
            if (idempotency_result.status === "in_progress") {
                return {
                    success: false,
                    errors: ["Request already in progress"],
                };
            }
            // status === "failed" - allow retry
        }
        // Claim idempotency key
        const claimed = await (0, idempotency_store_1.claim_key)(ctx, ctx.idempotency_key);
        perf.writes++;
        if (!claimed) {
            return {
                success: false,
                errors: ["Request already in progress"],
            };
        }
        key_claimed = true;
        // =========================================================================
        // 2. RESOLVER: Gather dependencies
        // =========================================================================
        const deps = await (0, plaid_1.resolve_link_account_dependencies)(ctx, {
            user_id: ctx.user_id,
            institution_id: ctx.input.institution_id,
        });
        perf.reads += 2; // user doc, plaid_items query
        // Log if institution is already linked (informational)
        if (deps.institution_already_linked) {
            console.log(`[${ctx.trace_id}] Institution ${ctx.input.institution_id} already linked ` +
                `for user ${ctx.user_id}, item_id: ${deps.existing_item_id}. Proceeding with re-link.`);
        }
        // =========================================================================
        // 3. DOMAIN SERVICE: Validate request
        // =========================================================================
        const validation = (0, plaid_2.validate_link_account_request)({
            user_id: ctx.user_id,
            public_token: ctx.input.public_token,
            institution_id: ctx.input.institution_id,
            institution_name: ctx.input.institution_name,
            institution_already_linked: deps.institution_already_linked,
        });
        if (validation.validation_errors && validation.validation_errors.length > 0) {
            (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
                user_id: ctx.user_id,
                error_code: "VALIDATION_FAILED",
                context: { errors: validation.validation_errors },
            });
            await (0, idempotency_store_1.fail_key)(ctx, ctx.idempotency_key, "Validation failed");
            return {
                success: false,
                errors: validation.validation_errors,
            };
        }
        // =========================================================================
        // 4. INTEGRATION CLIENT: Exchange public token
        // =========================================================================
        const raw_response = await (0, plaid_3.exchange_public_token)(ctx.input.public_token);
        const exchange_result = (0, plaid_3.transform_token_exchange_response)(raw_response);
        perf.reads++; // External API call counted as read
        // =========================================================================
        // 5. DOMAIN SERVICE: Validate Plaid item for creation
        // =========================================================================
        const item_validation = (0, plaid_2.validate_plaid_item_for_creation)({
            plaid_item_id: exchange_result.item_id,
            user_id: ctx.user_id,
            group_ids: deps.group_ids,
            institution_id: ctx.input.institution_id,
            institution_name: ctx.input.institution_name,
            access_token: exchange_result.access_token,
        });
        if (item_validation.validation_errors && item_validation.validation_errors.length > 0) {
            await (0, idempotency_store_1.fail_key)(ctx, ctx.idempotency_key, "Item validation failed");
            return {
                success: false,
                errors: item_validation.validation_errors,
            };
        }
        // =========================================================================
        // 6. REPOSITORY: Save Plaid item
        // =========================================================================
        const now = firestore_1.Timestamp.now();
        const encrypted_token = (0, encryption_1.encryptAccessToken)(exchange_result.access_token);
        const plaid_item = {
            id: exchange_result.item_id,
            plaid_item_id: exchange_result.item_id,
            user_id: ctx.user_id,
            group_ids: deps.group_ids,
            institution_id: ctx.input.institution_id,
            institution_name: ctx.input.institution_name,
            institution_logo: null,
            access_token: encrypted_token,
            cursor: null,
            products: ["transactions"],
            status: "good",
            error: null,
            last_webhook_received: null,
            last_sync_error: null,
            last_sync_error_at: null,
            last_synced_at: null,
            is_active: true,
            created_at: now,
            updated_at: now,
        };
        await plaid_4.plaid_item_repo.save(ctx, plaid_item);
        perf.writes++;
        // =========================================================================
        // 7. EMIT EVENTS
        // =========================================================================
        const event_payload = {
            item_id: exchange_result.item_id,
            user_id: ctx.user_id,
            institution_id: ctx.input.institution_id,
            institution_name: ctx.input.institution_name,
            created_at: now,
        };
        events.emit(events_1.PLAID_EVENTS.ITEM_CREATED, event_payload);
        // =========================================================================
        // 8. COMPLETE IDEMPOTENCY KEY
        // =========================================================================
        const result = {
            success: true,
            data: {
                item_id: exchange_result.item_id,
                institution_id: ctx.input.institution_id,
                institution_name: ctx.input.institution_name,
                accounts_linked: 0, // Accounts are linked by trigger
                account_ids: [], // Will be populated by trigger
                request_id: exchange_result.request_id,
            },
        };
        await (0, idempotency_store_1.complete_key)(ctx, ctx.idempotency_key, result);
        perf.writes++;
        // Check performance budget
        if ((0, types_1.is_budget_exceeded)(perf, types_1.LINK_PLAID_ACCOUNT_BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for link_plaid_account: ` +
                `reads=${perf.reads}, writes=${perf.writes}, time=${perf.time_ms}ms`);
        }
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "link_plaid_account",
            status: "success",
            output: {
                item_id: exchange_result.item_id,
                request_id: exchange_result.request_id,
            },
            context: {
                institution_id: ctx.input.institution_id,
                was_relink: deps.institution_already_linked,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        return result;
    }
    catch (error) {
        // Log the full error for debugging
        console.error("[link_plaid_account_orchestrator] Error:", error);
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: ctx.user_id, error_code: "LINK_PLAID_ACCOUNT_FAILED" });
        // Release idempotency key on failure
        if (key_claimed) {
            try {
                await (0, idempotency_store_1.fail_key)(ctx, ctx.idempotency_key, error instanceof Error ? error.message : "Unknown error");
            }
            catch (fail_error) {
                console.error("Failed to release idempotency key:", fail_error);
            }
        }
        // Return generic error message (per project decisions)
        return {
            success: false,
            errors: ["Unable to connect to bank. Please try again later."],
        };
    }
}
//# sourceMappingURL=link_plaid_account.orchestrator.js.map