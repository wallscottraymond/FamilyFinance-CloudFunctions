"use strict";
/**
 * Sync Transactions Orchestrator
 *
 * Coordinates the transaction synchronization flow:
 * 1. Resolver: Get plaid_item with access token and pending transactions
 * 2. Integration: Fetch transactions from Plaid /transactions/sync
 * 3. Transform: Convert Plaid format to domain format
 * 4. Domain: Validate and handle pending->posted migrations
 * 5. Pipeline: Run through existing 6-step processing (categories, periods, budgets, outflows)
 * 6. Repository: Persist transactions, soft-delete removed ones
 * 7. Events: Emit transaction sync events
 * 8. Update cursor for incremental sync
 *
 * NOTE: Budget calculations are handled by existing Firestore triggers.
 * This orchestrator only syncs transactions from Plaid to Firestore.
 *
 * @module orchestrators/plaid/sync_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync_transactions_orchestrator = sync_transactions_orchestrator;
const observability_1 = require("../../observability");
const plaid_1 = require("../../types/plaid");
const plaid_2 = require("../../resolvers/plaid");
const plaid_3 = require("../../integrations/plaid");
const plaid_4 = require("../../integrations/plaid");
const plaid_5 = require("../../domain/plaid");
const repositories_1 = require("../../repositories");
const plaid_6 = require("../../repositories/plaid");
// Import pipeline utilities (snake_case versions)
const format_transactions_1 = require("../../transactions/utils/format_transactions");
const match_categories_to_transactions_1 = require("../../transactions/utils/match_categories_to_transactions");
const match_transaction_splits_to_source_periods_1 = require("../../transactions/utils/match_transaction_splits_to_source_periods");
/**
 * Orchestrates the transaction synchronization flow.
 *
 * This orchestrator:
 * 1. Fetches transactions from Plaid using cursor-based pagination
 * 2. Processes added, modified, and removed transactions
 * 3. Handles pending->posted migrations to preserve user modifications
 * 4. Runs transactions through the 6-step processing pipeline
 * 5. Persists results to Firestore
 * 6. Updates the cursor for incremental sync
 *
 * @param ctx - Orchestrator context with input and user info
 * @returns Sync results with counts and next cursor
 */
async function sync_transactions_orchestrator(ctx) {
    const start_time = Date.now();
    const errors = [];
    console.log(`[${ctx.trace_id}] Starting transaction sync for user ${ctx.user_id}, item ${ctx.input.item_id}`);
    // 1. RESOLVE DEPENDENCIES
    const deps = await (0, plaid_2.resolve_transaction_sync_dependencies)((0, observability_1.create_child_span)(ctx), {
        item_id: ctx.input.item_id,
        user_id: ctx.user_id,
    });
    if (!deps) {
        return {
            success: false,
            added_count: 0,
            modified_count: 0,
            removed_count: 0,
            pending_migrated_count: 0,
            next_cursor: null,
            has_more: false,
            error: "Failed to resolve dependencies - item not found or not accessible",
        };
    }
    // Use provided cursor or stored cursor
    let current_cursor = ctx.input.cursor || deps.plaid_item.cursor;
    let total_added = 0;
    let total_modified = 0;
    let total_removed = 0;
    let total_migrated = 0;
    let has_more = true;
    let next_cursor = null;
    // 2. PAGINATE THROUGH PLAID SYNC API
    while (has_more && (0, plaid_5.should_continue_sync)(errors)) {
        console.log(`[${ctx.trace_id}] Fetching transactions page, cursor: ${current_cursor || "initial"}`);
        // 2a. CALL PLAID INTEGRATION
        let plaid_response;
        try {
            plaid_response = await (0, plaid_4.sync_transactions)(deps.plaid_item.access_token, current_cursor);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Failed to fetch transactions from Plaid:`, error_msg);
            errors.push(`Plaid API error: ${error_msg}`);
            break;
        }
        console.log(`[${ctx.trace_id}] Plaid sync response: added=${plaid_response.added.length}, ` +
            `modified=${plaid_response.modified.length}, removed=${plaid_response.removed.length}, ` +
            `has_more=${plaid_response.has_more}`);
        // 2b. FILTER OUT TRANSACTIONS FOR HIDDEN ACCOUNTS
        // Silently discard transactions for accounts that have been hidden/removed
        const filter_for_active_accounts = (transactions) => {
            const filtered = transactions.filter(txn => deps.active_account_ids.has(txn.account_id));
            const discarded = transactions.length - filtered.length;
            if (discarded > 0) {
                console.log(`[${ctx.trace_id}] Discarded ${discarded} transactions for hidden accounts`);
            }
            return filtered;
        };
        const active_added = filter_for_active_accounts(plaid_response.added);
        const active_modified = filter_for_active_accounts(plaid_response.modified);
        // 2c. PROCESS ADDED TRANSACTIONS (only for active accounts)
        if (active_added.length > 0) {
            try {
                const page_result = await process_added_transactions(ctx, active_added, deps, errors);
                total_added += page_result.created;
                total_migrated += page_result.migrated;
            }
            catch (error) {
                const error_msg = error instanceof Error ? error.message : "Unknown error";
                console.error(`[${ctx.trace_id}] Error processing added transactions:`, error_msg);
                errors.push(`Processing error: ${error_msg}`);
            }
        }
        // 2d. PROCESS MODIFIED TRANSACTIONS (only for active accounts)
        if (active_modified.length > 0) {
            try {
                const modified_result = await process_modified_transactions(ctx, active_modified, deps);
                total_modified += modified_result.updated;
            }
            catch (error) {
                const error_msg = error instanceof Error ? error.message : "Unknown error";
                console.error(`[${ctx.trace_id}] Error processing modified transactions:`, error_msg);
                errors.push(`Modification error: ${error_msg}`);
            }
        }
        // 2e. PROCESS REMOVED TRANSACTIONS
        if (plaid_response.removed.length > 0) {
            try {
                const removed_ids = (0, plaid_3.extract_removed_transaction_ids)(plaid_response.removed);
                const remove_results = await repositories_1.transaction_repo.soft_delete_by_plaid_ids((0, observability_1.create_child_span)(ctx), ctx.user_id, removed_ids, "Removed by Plaid sync");
                total_removed += remove_results.length;
                console.log(`[${ctx.trace_id}] Soft-deleted ${remove_results.length} removed transactions`);
            }
            catch (error) {
                const error_msg = error instanceof Error ? error.message : "Unknown error";
                console.error(`[${ctx.trace_id}] Error processing removed transactions:`, error_msg);
                errors.push(`Removal error: ${error_msg}`);
            }
        }
        // 2f. UPDATE PAGINATION STATE
        has_more = plaid_response.has_more;
        next_cursor = plaid_response.next_cursor;
        current_cursor = plaid_response.next_cursor;
        // Brief delay between pages to avoid rate limiting
        if (has_more) {
            await new Promise(resolve => setTimeout(resolve, plaid_1.PLAID_SYNC_PAGE_DELAY_MS));
        }
    }
    // 3. UPDATE CURSOR
    try {
        await plaid_6.plaid_item_repo.update_cursor((0, observability_1.create_child_span)(ctx), deps.plaid_item.doc_id, next_cursor);
    }
    catch (error) {
        const error_msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${ctx.trace_id}] Failed to update cursor:`, error_msg);
        errors.push(`Cursor update error: ${error_msg}`);
    }
    // 4. BUILD RESULT
    const duration_ms = Date.now() - start_time;
    console.log(`[${ctx.trace_id}] Transaction sync completed in ${duration_ms}ms: ` +
        `added=${total_added}, modified=${total_modified}, removed=${total_removed}, ` +
        `migrated=${total_migrated}, errors=${errors.length}`);
    // Check performance budget
    if (duration_ms > plaid_1.TRANSACTION_SYNC_BUDGET.max_time_ms) {
        console.warn(`[${ctx.trace_id}] Transaction sync exceeded time budget: ${duration_ms}ms > ${plaid_1.TRANSACTION_SYNC_BUDGET.max_time_ms}ms`);
    }
    return (0, plaid_5.aggregate_transaction_sync_results)(total_added, total_modified, total_removed, total_migrated, has_more, next_cursor, errors.length > 0 ? errors : undefined);
}
/**
 * Process added transactions through the 6-step pipeline.
 *
 * This wraps the existing pipeline utilities to maintain compatibility
 * with the current system while fitting into the new architecture.
 */
async function process_added_transactions(ctx, plaid_transactions, deps, errors) {
    // Identify pending->posted migrations BEFORE processing
    const migrations = (0, plaid_3.identify_pending_migrations)(plaid_transactions, deps.pending_transactions);
    console.log(`[${ctx.trace_id}] Identified ${migrations.length} pending->posted migrations`);
    // Migrations are processed through the SAME pipeline as new transactions (so the
    // posted txn gets its real Plaid data — name/account/date/category), then we OVERLAY
    // the pending's user splits (budget + outflow/inflow link + denorm arrays + categories
    // + tags) onto the posted so a user's manual assignment on a PENDING txn survives the
    // pending->posted resync. The pending itself is soft-deleted via Plaid's `removed` array.
    const migration_by_posted = new Map(migrations.map((m) => [m.posted_plaid_transaction_id, m]));
    let created = 0;
    let migrated = 0;
    // Process all synced transactions through the existing pipeline (P2-13: the
    // `new_transactions` alias for `plaid_transactions` was redundant — inlined).
    if (plaid_transactions.length > 0) {
        try {
            // Step 1: Format transactions (Plaid -> internal structure)
            const formatted = await (0, format_transactions_1.format_transactions)(plaid_transactions, deps.plaid_item.plaid_item_id, ctx.user_id, deps.user_context.family_id || undefined, deps.user_context.currency);
            console.log(`[${ctx.trace_id}] Step 1/6: Formatted ${formatted.length} transactions`);
            // Step 2: Match categories
            const with_categories = await (0, match_categories_to_transactions_1.match_categories_to_transactions)(formatted, ctx.user_id);
            console.log(`[${ctx.trace_id}] Step 2/6: Matched categories`);
            // Step 3: Match source periods
            const with_periods = await (0, match_transaction_splits_to_source_periods_1.match_transaction_splits_to_source_periods)(with_categories);
            console.log(`[${ctx.trace_id}] Step 3/6: Matched source periods`);
            // Step 4: (inline budget assignment removed 2026-07-27) — the Transaction
            // Assignment Engine now owns budget assignment: it runs via
            // on_transaction_written after upsert (single source of truth), so an inline
            // pass here would just be overwritten. Splits are written unassigned and the
            // engine assigns them (+ EE fallback, stale-id fixing) within ~1-3s.
            // Step 5: (legacy outflow matcher removed 2026-06-13) — the engine also sets
            // split.outflow_id, and the reconcile engine updates outflow-period status.
            const final = with_periods;
            // Step 6a: Transform legacy format to new persistence format
            let transactions_for_persistence = (0, plaid_3.transform_legacy_to_persistence)(final, ctx.user_id, deps.user_context.group_ids);
            // Step 6a-migrate: for each pending->posted migration, OVERLAY the pending's
            // user splits onto the posted txn (merge_pending_to_posted preserves budget +
            // outflow/inflow assignment + categories/tags, and proportionally rescales if the
            // amount changed). Now the posted base has real Plaid data (unlike the old stub).
            if (migration_by_posted.size > 0) {
                transactions_for_persistence = transactions_for_persistence.map((t) => {
                    const m = migration_by_posted.get(t.transaction_id);
                    return m ? (0, plaid_5.merge_pending_to_posted)(t, m) : t;
                });
                migrated = transactions_for_persistence.filter((t) => migration_by_posted.has(t.transaction_id)).length;
            }
            console.log(`[${ctx.trace_id}] Step 6a: Transformed ${transactions_for_persistence.length} transactions (${migrated} inherited splits from a posted pending)`);
            // Step 6b: Upsert transactions via new repository
            const upsert_result = await repositories_1.transaction_repo.upsert_from_plaid_sync((0, observability_1.create_child_span)(ctx), transactions_for_persistence, ctx.user_id, deps.plaid_item.plaid_item_id);
            console.log(`[${ctx.trace_id}] Step 6b: Upserted transactions (created=${upsert_result.created}, updated=${upsert_result.updated})`);
            // New creations exclude the migrated posted txns (they replace a pending, not net-new).
            created = Math.max(0, upsert_result.created - migrated);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Pipeline error:`, error_msg);
            errors.push(`Pipeline error: ${error_msg}`);
        }
    }
    return { created, migrated };
}
/**
 * Process modified transactions.
 *
 * For modified transactions, we only update if there are material changes
 * that affect budget calculations (amount, date, category).
 */
async function process_modified_transactions(ctx, plaid_transactions, deps) {
    let updated = 0;
    // For now, we run modified transactions through the same pipeline as added
    // This ensures categories, periods, and budgets are re-matched
    if (plaid_transactions.length > 0) {
        try {
            // Use the pipeline for updates
            const formatted = await (0, format_transactions_1.format_transactions)(plaid_transactions, deps.plaid_item.plaid_item_id, ctx.user_id, deps.user_context.family_id || undefined, deps.user_context.currency);
            const with_categories = await (0, match_categories_to_transactions_1.match_categories_to_transactions)(formatted, ctx.user_id);
            const with_periods = await (0, match_transaction_splits_to_source_periods_1.match_transaction_splits_to_source_periods)(with_categories);
            // Inline budget assignment removed 2026-07-27 — the Transaction Assignment
            // Engine assigns budgets (and outflow_id) via on_transaction_written after
            // upsert (single source of truth); reconcile updates outflow-period status.
            const final = with_periods;
            // Transform to new persistence format
            const transactions_for_persistence = (0, plaid_3.transform_legacy_to_persistence)(final, ctx.user_id, deps.user_context.group_ids);
            // Upsert via new repository
            const upsert_result = await repositories_1.transaction_repo.upsert_from_plaid_sync((0, observability_1.create_child_span)(ctx), transactions_for_persistence, ctx.user_id, deps.plaid_item.plaid_item_id);
            updated = upsert_result.updated;
            console.log(`[${ctx.trace_id}] Updated ${upsert_result.updated} modified transactions`);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error updating modified transactions:`, error_msg);
            throw error;
        }
    }
    return { updated };
}
//# sourceMappingURL=sync_transactions.orchestrator.js.map