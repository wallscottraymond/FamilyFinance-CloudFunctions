"use strict";
/**
 * Plaid Initial Sync Orchestrator
 *
 * Coordinates the complete initial data sync when a Plaid item is created:
 * 1. Create accounts (with balances from Plaid)
 * 2. Sync transactions
 * 3. Sync recurring transactions (inflows/outflows)
 *
 * This follows the 5-layer architecture with the trigger entry calling
 * exactly ONE orchestrator.
 *
 * @module orchestrators/plaid/plaid_initial_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plaid_initial_sync_orchestrator = plaid_initial_sync_orchestrator;
const sync_item_orchestrator_1 = require("./sync_item.orchestrator");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const idempotency_store_1 = require("../../infrastructure/idempotency_store");
const plaid_1 = require("../../resolvers/plaid");
const plaid_2 = require("../../domain/plaid");
const account_repo_1 = require("../../repositories/account.repo");
const events_1 = require("../../events");
const plaid_3 = require("../../integrations/plaid");
/**
 * Orchestrates the complete initial sync when a Plaid item is created.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Resolve dependencies (plaid_item, user groups, institution)
 * 3. Domain validation
 * 4. PHASE 1: Create accounts (with balances)
 * 5. PHASE 2: Sync transactions (wraps legacy function)
 * 6. PHASE 3: Sync recurring (wraps legacy function)
 * 7. Update plaid_item with sync timestamps
 * 8. Complete idempotency key
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Orchestrator result with sync statistics
 */
async function plaid_initial_sync_orchestrator(ctx) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "plaid_initial_sync");
    const perf = (0, types_1.create_performance_metrics)();
    const events = (0, events_1.create_event_emitter)(ctx.trace_id, span.span_id, ctx.user_id);
    const start_time = Date.now();
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    let key_claimed = false;
    const phases = [];
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
                    phases: [],
                    summary: create_empty_summary(),
                    errors: ["Initial sync already in progress"],
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
                phases: [],
                summary: create_empty_summary(),
                errors: ["Initial sync already in progress"],
            };
        }
        key_claimed = true;
        // =========================================================================
        // 2. RESOLVER: Gather dependencies
        // =========================================================================
        const deps = await (0, plaid_1.resolve_initial_sync_dependencies)(ctx, ctx.input);
        perf.reads += 2; // plaid_item doc + user doc
        // =========================================================================
        // 3. DOMAIN SERVICE: Validate sync can proceed
        // =========================================================================
        const validation = (0, plaid_2.validate_initial_sync)({
            plaid_item_id: ctx.input.plaid_item_id,
            user_id: ctx.user_id,
            item_exists: true, // We got deps, so item exists
            has_access_token: !!deps.plaid_item.access_token,
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
                phases: [],
                summary: create_empty_summary(),
                errors: validation.validation_errors,
            };
        }
        // =========================================================================
        // 4. PHASE 1: Create Accounts (with balances)
        // =========================================================================
        const accounts_phase = await execute_accounts_phase(ctx, deps, events, perf);
        phases.push(accounts_phase);
        // Check if we should continue
        if (!accounts_phase.success) {
            const should_continue = (0, plaid_2.should_continue_after_failure)("accounts", accounts_phase.error_message || "");
            if (!should_continue) {
                // Critical error - abort remaining phases
                const end_time = Date.now();
                const result = (0, plaid_2.aggregate_sync_results)(phases, start_time, end_time);
                await (0, idempotency_store_1.fail_key)(ctx, ctx.idempotency_key, accounts_phase.error_message || "Accounts phase failed");
                return result;
            }
        }
        // =========================================================================
        // 5. QUEUE THE ITEM SYNC (transactions + bills/income, one writer, one pass)
        // =========================================================================
        // Plaid's history pull is async, so there's usually nothing to fetch yet. `sync_item` runs
        // now (no delay → immediate job), retries every minute while Plaid reports NOT_READY, and
        // SYNC_UPDATES_AVAILABLE / RECURRING_TRANSACTIONS webhooks queue it again — all coalesced
        // onto one lease per item. Replaces the inline transaction + recurring phases, the
        // `resync_transactions` chain (2–9 min sweep hops) and the step that reset the cursor.
        try {
            await (0, sync_item_orchestrator_1.enqueue_item_sync)({
                item_doc_id: ctx.input.item_doc_id,
                user_id: ctx.user_id,
                recurring: true,
                reason: "first_link",
                trace_id: ctx.trace_id,
            });
            phases.push((0, plaid_2.create_success_phase_result)("transactions", { created: 0, updated: 0 }, 0));
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : "unknown";
            console.error(`[${ctx.trace_id}] Failed to queue the first item sync:`, msg);
            phases.push((0, plaid_2.create_failure_phase_result)("transactions", msg, 0));
        }
        // =========================================================================
        // 8. COMPLETE IDEMPOTENCY KEY
        // =========================================================================
        const end_time = Date.now();
        const result = (0, plaid_2.aggregate_sync_results)(phases, start_time, end_time);
        await (0, idempotency_store_1.complete_key)(ctx, ctx.idempotency_key, result);
        perf.writes++;
        // Check performance budget
        if ((0, types_1.is_budget_exceeded)(perf, types_1.INITIAL_SYNC_BUDGET)) {
            console.warn(`[${ctx.trace_id}] Performance budget exceeded for plaid_initial_sync: ` +
                `reads=${perf.reads}, writes=${perf.writes}, time=${perf.time_ms}ms`);
        }
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        // Async debug logging
        (0, observability_1.fire_and_forget)(() => (0, observability_1.log_async_debug)({
            trace_id: ctx.trace_id,
            span_id: span.span_id,
            layer: "orchestrator",
            function: "plaid_initial_sync",
            status: "success",
            output: {
                plaid_item_id: ctx.input.plaid_item_id,
                accounts_created: result.summary.accounts_created,
                transactions_added: result.summary.transactions_added,
            },
            context: {
                institution_id: ctx.input.institution_id,
                total_duration_ms: result.summary.total_duration_ms,
                perf_reads: perf.reads,
                perf_writes: perf.writes,
            },
        }));
        return result;
    }
    catch (error) {
        console.error("[plaid_initial_sync_orchestrator] Error:", error);
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: ctx.user_id, error_code: "PLAID_INITIAL_SYNC_FAILED" });
        // Release idempotency key on failure
        if (key_claimed) {
            try {
                await (0, idempotency_store_1.fail_key)(ctx, ctx.idempotency_key, error instanceof Error ? error.message : "Unknown error");
            }
            catch (fail_error) {
                console.error("Failed to release idempotency key:", fail_error);
            }
        }
        const end_time = Date.now();
        return {
            success: false,
            phases,
            summary: Object.assign(Object.assign({}, create_empty_summary()), { total_duration_ms: end_time - start_time }),
            errors: [error instanceof Error ? error.message : "Unknown error"],
        };
    }
}
// =============================================================================
// Phase Execution Functions
// =============================================================================
/**
 * Executes the accounts creation phase.
 *
 * Uses the shared upsert_from_plaid() method from account_repo to ensure
 * consistency with balance sync. Creates accounts if they don't exist,
 * updates balances if they do.
 */
async function execute_accounts_phase(ctx, deps, events, perf) {
    const phase_start = Date.now();
    try {
        console.log(`[${ctx.trace_id}] PHASE 1: Syncing accounts for item ${ctx.input.plaid_item_id}`);
        // 1. Fetch accounts from Plaid using integration client (RAW SDK accounts),
        //    then transform to the domain shape.
        // `/accounts/get` (balances Plaid refreshed during Link) — not `/accounts/balance/get`, a live
        // bank round trip that often takes seconds and is billed per call. Liabilities in parallel.
        const [raw_accounts, raw_liabilities] = await Promise.all([
            (0, plaid_3.fetch_plaid_accounts)(deps.plaid_item.access_token),
            (0, plaid_3.safe_fetch_liabilities)(deps.plaid_item.access_token, ctx.trace_id),
        ]);
        const plaid_result = Object.assign(Object.assign({}, raw_accounts), { accounts: (0, plaid_3.plaid_accounts_to_data)(raw_accounts.accounts) });
        perf.reads++; // External API call
        console.log(`[${ctx.trace_id}] Fetched ${plaid_result.accounts.length} accounts from Plaid`);
        if (plaid_result.accounts.length === 0) {
            return (0, plaid_2.create_success_phase_result)("accounts", { created: 0, updated: 0 }, Date.now() - phase_start);
        }
        // 1b. Liability detail (Investments-And-Liabilities-Modeling) — fetched above in parallel;
        //     never fails the sync: cash-only items return null (no Liabilities product).
        const liabilities = (0, plaid_3.plaid_liabilities_to_domain)(raw_liabilities);
        // 2. Upsert accounts using shared repository method
        // This creates accounts if they don't exist, updates balances if they do
        const group_id = deps.group_ids.length > 0 ? deps.group_ids[0] : undefined;
        const upsert_result = await account_repo_1.account_repo.upsert_from_plaid({ trace_id: ctx.trace_id, span_id: ctx.span_id }, plaid_result.accounts, ctx.input.plaid_item_id, ctx.user_id, { id: ctx.input.institution_id, name: ctx.input.institution_name }, group_id, liabilities);
        perf.writes += upsert_result.created + upsert_result.updated;
        // 3. Emit events for each account created
        const now = firestore_1.Timestamp.now();
        for (const result of upsert_result.results) {
            if (result.action === "created") {
                const event_payload = {
                    account_id: result.doc_id,
                    user_id: ctx.user_id,
                    item_id: ctx.input.plaid_item_id,
                    institution_id: ctx.input.institution_id,
                    institution_name: ctx.input.institution_name,
                    account_type: "unknown", // Not tracked in upsert result, but acceptable
                    created_at: now,
                };
                events.emit(events_1.ACCOUNT_EVENTS.CREATED, event_payload);
            }
        }
        console.log(`[${ctx.trace_id}] Accounts phase: created=${upsert_result.created}, updated=${upsert_result.updated}`);
        return (0, plaid_2.create_success_phase_result)("accounts", { created: upsert_result.created, updated: upsert_result.updated }, Date.now() - phase_start);
    }
    catch (error) {
        console.error(`[${ctx.trace_id}] Accounts phase failed:`, error);
        return (0, plaid_2.create_failure_phase_result)("accounts", error instanceof Error ? error.message : "Unknown error", Date.now() - phase_start);
    }
}
// =============================================================================
// Helper Functions
// =============================================================================
/**
 * Creates an empty summary object.
 */
function create_empty_summary() {
    return {
        accounts_created: 0,
        transactions_added: 0,
        transactions_modified: 0,
        transactions_removed: 0,
        inflows_created: 0,
        inflows_updated: 0,
        outflows_created: 0,
        outflows_updated: 0,
        total_duration_ms: 0,
    };
}
//# sourceMappingURL=plaid_initial_sync.orchestrator.js.map