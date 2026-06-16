"use strict";
/**
 * Webhook Balance Sync Orchestrator
 *
 * Coordinates balance synchronization triggered by Plaid webhooks.
 * Reuses the same underlying functions as on-demand sync for consistency.
 *
 * Flow:
 * 1. Resolver: Find plaid_item, check idempotency
 * 2. Integration: Fetch accounts/balances from Plaid
 * 3. Repository: Upsert accounts (create if new, update balances if exists)
 * 4. Events: Emit balance_updated events for changes
 * 5. Record webhook as processed
 *
 * @module orchestrators/plaid/webhook_balance_sync
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhook_balance_sync_orchestrator = webhook_balance_sync_orchestrator;
const observability_1 = require("../../observability");
const plaid_1 = require("../../types/plaid");
const webhook_balance_sync_resolver_1 = require("../../resolvers/plaid/webhook_balance_sync.resolver");
const plaid_2 = require("../../integrations/plaid");
const account_repo_1 = require("../../repositories/account.repo");
const plaid_3 = require("../../repositories/plaid");
const account_events_1 = require("../../events/account.events");
/**
 * Orchestrates webhook-triggered balance synchronization.
 *
 * This orchestrator:
 * - Is triggered by Plaid webhooks (NEW_ACCOUNTS_AVAILABLE, etc.)
 * - Reuses the same upsert_from_plaid() logic as on-demand sync
 * - Has tighter performance budget (webhooks need fast response)
 *
 * @param ctx - Orchestrator context with webhook input
 * @returns Sync results with updated accounts
 */
async function webhook_balance_sync_orchestrator(ctx) {
    const start_time = Date.now();
    console.log(`[${ctx.trace_id}] Webhook balance sync started: ` +
        `type=${ctx.input.webhook_type}, code=${ctx.input.webhook_code}, ` +
        `item=${ctx.input.plaid_item_id}`);
    // 1. RESOLVE DEPENDENCIES (includes idempotency check)
    const deps = await (0, webhook_balance_sync_resolver_1.resolve_webhook_balance_sync_dependencies)((0, observability_1.create_child_span)(ctx), ctx.input);
    // Handle already processed webhook (idempotent return)
    if (deps.already_processed) {
        console.log(`[${ctx.trace_id}] Webhook already processed, returning`);
        return {
            success: true,
            accounts_created: 0,
            accounts_updated: 0,
            accounts_failed: 0,
            accounts: [],
            skipped: true,
            skip_reason: "Webhook already processed",
        };
    }
    // Handle item not found
    if (!deps.item) {
        console.warn(`[${ctx.trace_id}] Item not found for webhook`);
        // Record webhook as failed
        await plaid_3.plaid_webhook_repo.record_processed(ctx, ctx.input, false, "Item not found");
        return {
            success: false,
            accounts_created: 0,
            accounts_updated: 0,
            accounts_failed: 0,
            accounts: [],
            error: "Plaid item not found in database",
        };
    }
    // 2. FETCH ACCOUNTS/BALANCES FROM PLAID
    let plaid_result;
    try {
        const raw = await (0, plaid_2.fetch_plaid_balances)(deps.item.access_token);
        // Integration client returns RAW SDK accounts — transform to domain here.
        plaid_result = Object.assign(Object.assign({}, raw), { accounts: (0, plaid_2.plaid_accounts_to_data)(raw.accounts) });
    }
    catch (error) {
        const error_msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${ctx.trace_id}] Failed to fetch balances from Plaid:`, error_msg);
        // Record webhook as failed
        await plaid_3.plaid_webhook_repo.record_processed(ctx, ctx.input, false, `Plaid API error: ${error_msg}`);
        return {
            success: false,
            accounts_created: 0,
            accounts_updated: 0,
            accounts_failed: 0,
            accounts: [],
            error: `Failed to fetch balances: ${error_msg}`,
        };
    }
    if (plaid_result.accounts.length === 0) {
        console.log(`[${ctx.trace_id}] No accounts returned from Plaid`);
        // Record webhook as completed (success but no accounts)
        await plaid_3.plaid_webhook_repo.record_processed(ctx, ctx.input, true, "No accounts returned from Plaid");
        // Still fetch existing accounts to return
        const accounts = await account_repo_1.account_repo.get_for_client_response((0, observability_1.create_child_span)(ctx), deps.item.user_id, deps.item.plaid_item_id);
        return {
            success: true,
            accounts_created: 0,
            accounts_updated: 0,
            accounts_failed: 0,
            accounts,
        };
    }
    // 3. UPSERT ACCOUNTS (create if new, update balances if exists)
    const events_to_emit = [];
    let accounts_created = 0;
    let accounts_updated = 0;
    try {
        const upsert_result = await account_repo_1.account_repo.upsert_from_plaid((0, observability_1.create_child_span)(ctx), plaid_result.accounts, deps.item.plaid_item_id, deps.item.user_id, { id: deps.item.institution_id, name: deps.item.institution_name }, deps.item.group_id);
        accounts_created = upsert_result.created;
        accounts_updated = upsert_result.updated;
        // Track balance changes for event emission
        for (const result of upsert_result.results) {
            if (result.action === "updated" &&
                result.previous_balance !== undefined &&
                result.previous_balance !== result.new_balance) {
                events_to_emit.push({
                    account_id: result.doc_id,
                    user_id: deps.item.user_id,
                    previous_balance: result.previous_balance,
                    new_balance: result.new_balance,
                    change_amount: result.new_balance - result.previous_balance,
                });
            }
        }
        console.log(`[${ctx.trace_id}] Upserted accounts: created=${accounts_created}, updated=${accounts_updated}`);
    }
    catch (error) {
        const error_msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${ctx.trace_id}] Failed to upsert accounts:`, error_msg);
        // Record webhook as failed
        await plaid_3.plaid_webhook_repo.record_processed(ctx, ctx.input, false, `Database error: ${error_msg}`);
        return {
            success: false,
            accounts_created: 0,
            accounts_updated: 0,
            accounts_failed: plaid_result.accounts.length,
            accounts: [],
            error: `Failed to save accounts: ${error_msg}`,
        };
    }
    // 4. EMIT EVENTS for balance changes
    for (const event_payload of events_to_emit) {
        try {
            await account_events_1.ACCOUNT_EVENTS.emit_balance_updated(ctx, event_payload);
        }
        catch (error) {
            // Log but don't fail the sync
            console.error(`[${ctx.trace_id}] Failed to emit balance_updated event:`, error);
        }
    }
    // 5. FETCH UPDATED ACCOUNTS for response
    const accounts = await account_repo_1.account_repo.get_for_client_response((0, observability_1.create_child_span)(ctx), deps.item.user_id, deps.item.plaid_item_id);
    // 6. RECORD WEBHOOK as processed
    await plaid_3.plaid_webhook_repo.record_processed(ctx, ctx.input, true, `Synced: ${accounts_created} created, ${accounts_updated} updated`);
    const duration_ms = Date.now() - start_time;
    console.log(`[${ctx.trace_id}] Webhook balance sync completed in ${duration_ms}ms: ` +
        `${accounts_created} created, ${accounts_updated} updated, ` +
        `${events_to_emit.length} balance changes`);
    // Check performance budget
    if (duration_ms > plaid_1.WEBHOOK_BALANCE_SYNC_BUDGET.max_time_ms) {
        console.warn(`[${ctx.trace_id}] Webhook balance sync exceeded time budget: ` +
            `${duration_ms}ms > ${plaid_1.WEBHOOK_BALANCE_SYNC_BUDGET.max_time_ms}ms`);
    }
    return {
        success: true,
        accounts_created,
        accounts_updated,
        accounts_failed: 0,
        accounts,
    };
}
//# sourceMappingURL=webhook_balance_sync.orchestrator.js.map