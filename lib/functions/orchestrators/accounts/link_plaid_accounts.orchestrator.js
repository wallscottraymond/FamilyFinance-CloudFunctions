"use strict";
/**
 * Link Plaid Accounts Orchestrator
 *
 * Coordinates the workflow of fetching accounts from Plaid
 * and saving them to Firestore using the new architecture.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Fetch accounts from Plaid (Integration Client)
 * 3. Transform to domain entities (Integration Transformer - PURE)
 * 4. Save to Firestore (Repository)
 * 5. Emit domain events
 *
 * @module orchestrators/accounts/link_plaid_accounts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.link_plaid_accounts_orchestrator = link_plaid_accounts_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const repositories_1 = require("../../repositories");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const plaid_1 = require("../../integrations/plaid");
const events_1 = require("../../events");
/**
 * Performance budget for link_plaid_accounts.
 * Higher limits due to external API call and batch writes.
 */
const BUDGET = {
    max_reads: 15,
    max_writes: 25,
    max_time_ms: 30000, // 30 seconds (Plaid API can be slow)
};
/**
 * Orchestrates linking Plaid accounts to the user's profile.
 *
 * This function:
 * 1. Fetches account data from Plaid API
 * 2. Transforms Plaid data to domain entities
 * 3. Saves accounts to Firestore
 * 4. Emits account created events
 *
 * @param ctx - Trace context
 * @param user_id - User ID to link accounts to
 * @param input - Link accounts input
 * @returns Result with linked account info
 */
async function link_plaid_accounts_orchestrator(ctx, user_id, input) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "link_plaid_accounts");
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
                const cached = idempotency_result.cached_result;
                return Object.assign(Object.assign({}, cached), { was_idempotent: true });
            }
            if (idempotency_result.status === "in_progress") {
                throw new Error("Request already in progress");
            }
            // status === "failed" - allow retry
        }
        // 2. Claim idempotency key
        const claimed = await (0, idempotency_store_1.claim_key)(ctx, input.idempotency_key);
        perf.writes++;
        if (!claimed) {
            throw new Error("Request already in progress");
        }
        key_claimed = true;
        // 3. Fetch accounts from Plaid (Integration Client returns RAW SDK accounts),
        //    then transform to the domain shape.
        const raw_accounts = await (0, plaid_1.fetch_plaid_accounts)(input.access_token);
        const plaid_result = Object.assign(Object.assign({}, raw_accounts), { accounts: (0, plaid_1.plaid_accounts_to_data)(raw_accounts.accounts) });
        perf.reads++; // Count external API call as read
        if (plaid_result.accounts.length === 0) {
            // No accounts returned - still a success
            const empty_result = {
                success: true,
                accounts_linked: 0,
                account_ids: [],
                item_id: input.item_id,
                was_idempotent: false,
            };
            await (0, idempotency_store_1.complete_key)(ctx, input.idempotency_key, empty_result);
            perf.writes++;
            (0, observability_1.log_operation_success)(span, user_id);
            return empty_result;
        }
        // 4. Transform to domain entities (Integration Transformer - PURE)
        const now = firestore_1.Timestamp.now();
        const transform_result = (0, plaid_1.transform_plaid_accounts_to_domain)(plaid_result.accounts, {
            user_id,
            item_id: input.item_id,
            institution: input.institution,
            group_ids: input.group_ids,
            now,
        });
        // Handle validation errors
        if ((_a = transform_result.validation_errors) === null || _a === void 0 ? void 0 : _a.length) {
            console.warn(`[${ctx.trace_id}] Plaid account validation warnings:`, transform_result.validation_errors);
            // Continue with valid entities
        }
        const accounts_to_save = (_b = transform_result.entities) !== null && _b !== void 0 ? _b : [];
        if (accounts_to_save.length === 0) {
            throw new Error("All Plaid accounts failed validation");
        }
        // Check performance budget before writes
        if ((0, types_1.is_budget_exceeded)(perf, BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget warning for link_plaid_accounts`);
        }
        // 5. Save to Firestore (Repository) - using batch for efficiency
        // Note: We cast to Account type - the structure is compatible
        const batch_result = await repositories_1.account_repo.save_batch(ctx, accounts_to_save);
        perf.writes += batch_result.count;
        // 6. Complete idempotency key
        const result = {
            success: true,
            accounts_linked: accounts_to_save.length,
            account_ids: accounts_to_save.map(a => a.id),
            item_id: input.item_id,
            was_idempotent: false,
        };
        await (0, idempotency_store_1.complete_key)(ctx, input.idempotency_key, result);
        perf.writes++;
        (0, observability_1.log_operation_success)(span, user_id);
        // 7. Emit domain events for each account (fire-and-forget)
        for (const account of accounts_to_save) {
            const event_payload = {
                account_id: account.id,
                user_id,
                item_id: input.item_id,
                institution_id: input.institution.institution_id,
                institution_name: input.institution.name,
                account_type: account.account_type,
                created_at: now,
            };
            events.emit(events_1.ACCOUNT_EVENTS.CREATED, event_payload);
        }
        // 8. Async debug logging
        (0, observability_1.fire_and_forget)(() => {
            var _a, _b;
            return (0, observability_1.log_async_debug)({
                trace_id: ctx.trace_id,
                span_id: span.span_id,
                layer: "orchestrator",
                function: "link_plaid_accounts",
                status: "success",
                context: {
                    item_id: input.item_id,
                    accounts_from_plaid: plaid_result.accounts.length,
                    accounts_saved: accounts_to_save.length,
                    validation_errors: (_b = (_a = transform_result.validation_errors) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0,
                    perf_reads: perf.reads,
                    perf_writes: perf.writes,
                },
            });
        });
        return result;
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "LINK_PLAID_ACCOUNTS_FAILED" });
        // Release idempotency key on failure
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
//# sourceMappingURL=link_plaid_accounts.orchestrator.js.map