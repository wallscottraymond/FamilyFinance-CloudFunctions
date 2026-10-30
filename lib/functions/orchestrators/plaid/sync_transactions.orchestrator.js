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
 * One writer, one write per transaction: every page is pulled first, the assignment engine runs
 * in memory, each transaction is written once (stamped `syncRunId` so the per-transaction trigger
 * skips it), and ONE follow-up pass (bill/income reconcile, budget spent, transfer check, derive
 * bump) runs at the end — inline, not as hundreds of queued jobs.
 *
 * @module orchestrators/plaid/sync_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sync_transactions_orchestrator = sync_transactions_orchestrator;
const category_catalog_resolver_1 = require("../../resolvers/shared/category_catalog.resolver");
const split_category_service_1 = require("../../domain/transactions/split_category.service");
const observability_1 = require("../../observability");
const plaid_1 = require("../../types/plaid");
const rules_repo_1 = require("../../repositories/rules.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const rule_evaluation_service_1 = require("../../domain/rules/rule_evaluation.service");
const rule_application_service_1 = require("../../domain/rules/rule_application.service");
const plaid_2 = require("../../resolvers/plaid");
const plaid_3 = require("../../integrations/plaid");
const plaid_4 = require("../../integrations/plaid");
const plaid_5 = require("../../domain/plaid");
const repositories_1 = require("../../repositories");
const assign_in_memory_1 = require("../transactions/assign_in_memory");
const sync_follow_ups_1 = require("./sync_follow_ups");
const plaid_6 = require("../../repositories/plaid");
// Import pipeline utilities (snake_case versions)
const format_transactions_1 = require("../../transactions/utils/format_transactions");
const match_transaction_splits_to_source_periods_1 = require("../../transactions/utils/match_transaction_splits_to_source_periods");
const merge_modified_into_existing_service_1 = require("../../domain/plaid/merge_modified_into_existing.service");
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
async function sync_transactions_orchestrator(ctx, opts) {
    var _a, _b, _c;
    const start_time = Date.now();
    const errors = [];
    const run_id = (_a = opts === null || opts === void 0 ? void 0 : opts.run_id) !== null && _a !== void 0 ? _a : ctx.trace_id;
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
            follow_ups: (0, sync_follow_ups_1.empty_follow_ups)(),
        };
    }
    // 2. FETCH EVERY PAGE FIRST, then process (Plaid's guidance). Processing between pages widened
    // the window for TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION while Plaid is still writing a new
    // item's history; on that error the whole pull restarts from the starting cursor.
    const start_cursor = ctx.input.cursor || deps.plaid_item.cursor;
    const fetched = await fetch_all_pages(ctx, deps.plaid_item.access_token, start_cursor);
    if ("error" in fetched) {
        // Nothing written, cursor untouched — the next sync retries from the same place.
        return {
            success: false,
            added_count: 0,
            modified_count: 0,
            removed_count: 0,
            pending_migrated_count: 0,
            next_cursor: null,
            has_more: false,
            error: fetched.error,
            follow_ups: (0, sync_follow_ups_1.empty_follow_ups)(),
        };
    }
    // 2b. ACCOUNTS. Transactions for accounts the user hid are skipped on purpose. An account we
    // have no doc for YET (its write lost the race with this sync) must NOT be skipped — that used
    // to drop its transactions for good while the cursor moved past them. Stop without writing or
    // moving the cursor; the caller saves the accounts and syncs again.
    const all_txns = [...fetched.added, ...fetched.modified];
    const unknown_accounts = [
        ...new Set(all_txns.map((t) => t.account_id).filter((id) => !deps.known_account_ids.has(id))),
    ];
    if (unknown_accounts.length > 0) {
        console.warn(`[${ctx.trace_id}] ${unknown_accounts.length} account(s) not saved yet — deferring the sync ` +
            `(no writes, cursor unchanged): ${unknown_accounts.join(",")}`);
        return {
            success: false,
            added_count: 0,
            modified_count: 0,
            removed_count: 0,
            pending_migrated_count: 0,
            next_cursor: null,
            has_more: false,
            error: "accounts_not_saved",
            needs_accounts: true,
            update_status: fetched.update_status,
            follow_ups: (0, sync_follow_ups_1.empty_follow_ups)(),
        };
    }
    // Transactions for an account the user removed are NOT dropped (the cursor moves past them, so
    // a restore would lose them): they are stored hidden (`hiddenReason: "account_removed"`), and
    // restoring the account brings them back (Code-Health-Review P1-H2). See mark_hidden_for_removed.
    const active_added = fetched.added;
    const active_modified = fetched.modified;
    const hidden_count = all_txns.filter((t) => !deps.active_account_ids.has(t.account_id)).length;
    if (hidden_count > 0) {
        console.log(`[${ctx.trace_id}] Storing ${hidden_count} transactions hidden (removed accounts)`);
    }
    // Load the user's active rules ONCE per sync (first-write-only transform on new docs).
    const active_rules = await rules_repo_1.rules_repo.get_active_rules((0, observability_1.create_child_span)(ctx), ctx.user_id);
    // A rule's category condition compares the transaction's FIRST category (canon M7) — from the
    // ONE category function over the module-cached catalog.
    const catalog = active_rules.length > 0 ? await (0, category_catalog_resolver_1.load_category_catalog)(ctx) : null;
    // "Mark as income" → the income category (Plaid's "other income" → our first category).
    const income_slug = catalog
        ? (_b = (0, split_category_service_1.resolve_split_category)({ plaid_detailed: "INCOME_OTHER_INCOME", merchant_name: null, name: null }, catalog).first_category_id) !== null && _b !== void 0 ? _b : null
        : null;
    const on_create = active_rules.length > 0 && catalog
        ? (t) => {
            var _a, _b;
            return (0, rule_application_service_1.apply_rule_intents)(t, (0, rule_application_service_1.only_known_categories)((0, rule_application_service_1.with_income_category)((0, rule_evaluation_service_1.evaluate_rules)(Object.assign(Object.assign({}, t), { account_labels: (_b = (_a = deps.account_labels) === null || _a === void 0 ? void 0 : _a.get(t.account_id)) !== null && _b !== void 0 ? _b : [], first_category_id: (0, split_category_service_1.resolve_split_category)({
                    plaid_detailed: t.plaid_detailed_category || null,
                    merchant_name: t.merchant_name,
                    name: t.name,
                }, catalog).first_category_id }), active_rules), income_slug), (slug) => slug in catalog.plaid_by_first));
        }
        : undefined;
    // 3. ASSIGN IN MEMORY, WRITE ONCE. The engine's shared context (budgets, categories, the
    // authoritative bill/income stream membership) + date-span preloads are read once; every
    // transaction is then written with its final assignment and stamped with this run's id, so
    // `on_transaction_written` skips it and this sync does ONE follow-up pass instead.
    const written = [];
    let write_opts = { run_id };
    const dated = [...active_added, ...active_modified];
    if (dated.length > 0) {
        const times = dated.map((t) => new Date(t.date).getTime()).filter((n) => !isNaN(n));
        const assign = await (0, assign_in_memory_1.create_in_memory_assigner)((0, observability_1.create_child_span)(ctx), ctx.user_id, Math.min(...times), Math.max(...times) + 24 * 60 * 60 * 1000);
        write_opts = { run_id, before_write: (doc_id, data) => assign(doc_id, data) };
    }
    let total_added = 0;
    let total_modified = 0;
    let total_removed = 0;
    let total_migrated = 0;
    if (active_added.length > 0) {
        try {
            const page_result = await process_added_transactions(ctx, active_added, deps, errors, on_create, write_opts);
            total_added += page_result.created;
            total_migrated += page_result.migrated;
            written.push(...page_result.written);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error processing added transactions:`, error_msg);
            errors.push(`Processing error: ${error_msg}`);
        }
    }
    if (active_modified.length > 0) {
        try {
            const modified_result = await process_modified_transactions(ctx, active_modified, deps, write_opts);
            total_modified += modified_result.updated;
            written.push(...modified_result.written);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error processing modified transactions:`, error_msg);
            errors.push(`Modification error: ${error_msg}`);
            // Chunks that committed before the failure are still followed up.
            written.push(...((_c = error.partial_written) !== null && _c !== void 0 ? _c : []));
        }
    }
    if (fetched.removed.length > 0) {
        try {
            const removed_ids = (0, plaid_3.extract_removed_transaction_ids)(fetched.removed);
            const remove_results = await repositories_1.transaction_repo.soft_delete_by_plaid_ids((0, observability_1.create_child_span)(ctx), ctx.user_id, removed_ids, "Removed by Plaid sync", { run_id, written });
            total_removed += remove_results.length;
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error processing removed transactions:`, error_msg);
            errors.push(`Removal error: ${error_msg}`);
        }
    }
    // 4. FOLLOW-UPS: what this sync's writes affect (before ∪ after) — budgets by date, and the
    // bills/income whose payments changed. Run once, here or by the caller (sync_item merges them
    // with the recurring sync's).
    const follow_ups = (0, sync_follow_ups_1.follow_ups_from_written)(written);
    if (written.length > 0) {
        if (opts === null || opts === void 0 ? void 0 : opts.defer_follow_ups) {
            // Caller runs them (and bumps the derive version once).
        }
        else {
            await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, ctx.user_id, follow_ups);
        }
    }
    // 4c. An account restored WHILE this sync ran: `deps` said "removed", so its transactions were
    // just written hidden, possibly after the restore job already ran. Re-check those accounts now
    // and bring their hidden transactions back. Whichever runs last (this check or the restore job)
    // catches them (Code-Health-Review batch 3 verify).
    await restore_hidden_for_reactivated_accounts(ctx, all_txns, deps.active_account_ids);
    // 5. CURSOR — only when every page was processed cleanly; never a null cursor. On an error the
    // cursor stays where it was so the next sync re-delivers (upserts are idempotent).
    if (errors.length === 0 && fetched.next_cursor) {
        try {
            await plaid_6.plaid_item_repo.update_cursor((0, observability_1.create_child_span)(ctx), deps.plaid_item.doc_id, fetched.next_cursor);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Failed to update cursor:`, error_msg);
            errors.push(`Cursor update error: ${error_msg}`);
        }
    }
    const duration_ms = Date.now() - start_time;
    console.log(`[${ctx.trace_id}] Transaction sync completed in ${duration_ms}ms: ` +
        `added=${total_added}, modified=${total_modified}, removed=${total_removed}, ` +
        `migrated=${total_migrated}, status=${fetched.update_status}, errors=${errors.length}`);
    if (duration_ms > plaid_1.TRANSACTION_SYNC_BUDGET.max_time_ms) {
        console.warn(`[${ctx.trace_id}] Transaction sync exceeded time budget: ${duration_ms}ms > ${plaid_1.TRANSACTION_SYNC_BUDGET.max_time_ms}ms`);
    }
    return Object.assign(Object.assign({}, (0, plaid_5.aggregate_transaction_sync_results)(total_added, total_modified, total_removed, total_migrated, false, fetched.next_cursor, errors.length > 0 ? errors : undefined)), { update_status: fetched.update_status, follow_ups });
}
async function restore_hidden_for_reactivated_accounts(ctx, txns, active_account_ids) {
    const hidden_accounts = [...new Set(txns.map((t) => t.account_id))]
        .filter((id) => !active_account_ids.has(id));
    let restored = 0;
    try {
        for (const account_id of hidden_accounts) {
            for (;;) {
                // Re-checked every page, like the restore job (P1-M8): stop if it's removed again.
                const account = await repositories_1.account_repo.get_by_plaid_account_id_any_status(ctx, account_id, ctx.user_id);
                if (!(account === null || account === void 0 ? void 0 : account.is_active))
                    break;
                const page = await repositories_1.transaction_repo.restore_for_account(ctx, account_id, ctx.user_id);
                restored += page.restored;
                if (!page.has_more || page.restored === 0)
                    break;
            }
        }
    }
    catch (error) {
        // Best effort: the queued restore job (or the next sync) still catches these rows.
        console.error(`[${ctx.trace_id}] Mid-sync restore re-check failed:`, error);
    }
    if (restored > 0) {
        console.log(`[${ctx.trace_id}] Restored ${restored} transactions of accounts restored mid-sync`);
        await (0, derive_version_repo_1.bump_derive_version)(ctx.user_id).catch(() => { });
    }
}
/** A transaction on an account the user removed is written hidden: inactive, not deleted, marked
 *  `account_removed` so restoring the account brings it back. A Plaid update keeps it hidden
 *  (the incoming copy is marked the same way). */
function mark_hidden_for_removed(txns, active_account_ids) {
    return txns.map((t) => active_account_ids.has(t.account_id)
        ? t
        : Object.assign(Object.assign({}, t), { is_active: false, is_hidden: true, hidden_reason: "account_removed" }));
}
/** Pull every page from `start_cursor`; restart (max 3×) on a mutation-during-pagination error. */
async function fetch_all_pages(ctx, access_token, start_cursor) {
    var _a;
    for (let attempt = 1; attempt <= 3; attempt++) {
        const added = [];
        const modified = [];
        const removed = [];
        let cursor = start_cursor;
        let next_cursor = null;
        let update_status = "UNKNOWN";
        let has_more = true;
        let restart = false;
        while (has_more) {
            let page;
            try {
                page = await (0, plaid_4.sync_transactions)(access_token, cursor);
            }
            catch (error) {
                if (plaid_error_code(error) === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && attempt < 3) {
                    console.warn(`[${ctx.trace_id}] Plaid data changed mid-pull — restarting from the start cursor`);
                    restart = true;
                    break;
                }
                const msg = error instanceof Error ? error.message : "Unknown error";
                console.error(`[${ctx.trace_id}] Failed to fetch transactions from Plaid:`, msg);
                return { error: `Plaid API error: ${msg}` };
            }
            added.push(...page.added);
            modified.push(...page.modified);
            removed.push(...page.removed);
            has_more = page.has_more;
            next_cursor = page.next_cursor;
            cursor = page.next_cursor;
            update_status = String((_a = page.transactions_update_status) !== null && _a !== void 0 ? _a : "UNKNOWN");
            if (has_more)
                await new Promise((r) => setTimeout(r, plaid_1.PLAID_SYNC_PAGE_DELAY_MS));
        }
        if (restart)
            continue;
        console.log(`[${ctx.trace_id}] Plaid pull: added=${added.length}, modified=${modified.length}, ` +
            `removed=${removed.length}, status=${update_status}`);
        return { added, modified, removed, next_cursor, update_status };
    }
    return { error: "Plaid data kept changing during the pull" };
}
function plaid_error_code(error) {
    var _a, _b;
    const data = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data;
    return (_b = data === null || data === void 0 ? void 0 : data.error_code) !== null && _b !== void 0 ? _b : null;
}
/**
 * Process added transactions through the 6-step pipeline.
 *
 * This wraps the existing pipeline utilities to maintain compatibility
 * with the current system while fitting into the new architecture.
 */
async function process_added_transactions(ctx, plaid_transactions, deps, errors, on_create, write_opts) {
    var _a;
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
    let written = [];
    // Process all synced transactions through the existing pipeline (P2-13: the
    // `new_transactions` alias for `plaid_transactions` was redundant — inlined).
    if (plaid_transactions.length > 0) {
        try {
            // Step 1: Format transactions (Plaid -> internal structure)
            const formatted = await (0, format_transactions_1.format_transactions)(plaid_transactions, deps.plaid_item.plaid_item_id, ctx.user_id, deps.user_context.family_id || undefined, deps.user_context.currency);
            console.log(`[${ctx.trace_id}] Step 1/6: Formatted ${formatted.length} transactions`);
            // Step 2: categories are NOT rewritten here — Plaid's codes are immutable (canon M1); the
            // collection's merchant / keyword rules apply in the ONE category function (M7) at assign.
            const with_categories = formatted;
            // Step 3: Match source periods
            const with_periods = await (0, match_transaction_splits_to_source_periods_1.match_transaction_splits_to_source_periods)(with_categories);
            console.log(`[${ctx.trace_id}] Step 3/6: Matched source periods`);
            // Step 4: budget / bill / income assignment — the Transaction Assignment Engine runs IN
            // MEMORY inside the upsert (`write_opts.before_write`), so each transaction is written
            // once, already assigned (no bare write + read-back + second write).
            const final = with_periods;
            // Step 6a: Transform legacy format to new persistence format
            let transactions_for_persistence = mark_hidden_for_removed((0, plaid_3.transform_legacy_to_persistence)(final, ctx.user_id, deps.user_context.group_ids), deps.active_account_ids);
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
            // Step 6b: Upsert transactions via new repository. The `on_create` hook (the Rules Engine)
            // applies ONLY to genuinely-new docs inside upsert's create branch (first-write-only). A
            // posted transaction that INHERITED its pending's splits is a new doc (new Plaid id) but not
            // a new transaction: the rules already ran on the pending, and the user may have edited it
            // since — re-running them would overwrite those edits. So it skips the rules.
            const on_create_new_only = on_create
                ? (t) => migration_by_posted.has(t.transaction_id) ? t : on_create(t)
                : undefined;
            const upsert_result = await repositories_1.transaction_repo.upsert_from_plaid_sync((0, observability_1.create_child_span)(ctx), transactions_for_persistence, ctx.user_id, deps.plaid_item.plaid_item_id, on_create_new_only, 
            // Existing doc → keep the user's edits, refresh only Plaid's fields.
            merge_modified_into_existing_service_1.merge_modified_into_existing, write_opts);
            written = upsert_result.written;
            console.log(`[${ctx.trace_id}] Step 6b: Upserted transactions (created=${upsert_result.created}, updated=${upsert_result.updated})`);
            // New creations exclude the migrated posted txns (they replace a pending, not net-new).
            created = Math.max(0, upsert_result.created - migrated);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Pipeline error:`, error_msg);
            errors.push(`Pipeline error: ${error_msg}`);
            // Chunks that committed before the failure are still followed up.
            written = (_a = error.partial_written) !== null && _a !== void 0 ? _a : [];
        }
    }
    return { created, migrated, written };
}
/**
 * Process modified transactions.
 *
 * For modified transactions, we only update if there are material changes
 * that affect budget calculations (amount, date, category).
 */
async function process_modified_transactions(ctx, plaid_transactions, deps, write_opts) {
    let updated = 0;
    let written = [];
    // For now, we run modified transactions through the same pipeline as added
    // This ensures categories, periods, and budgets are re-matched
    if (plaid_transactions.length > 0) {
        try {
            // Use the pipeline for updates
            const formatted = await (0, format_transactions_1.format_transactions)(plaid_transactions, deps.plaid_item.plaid_item_id, ctx.user_id, deps.user_context.family_id || undefined, deps.user_context.currency);
            const with_categories = formatted; // Plaid codes immutable (M1); rules apply in M7
            const with_periods = await (0, match_transaction_splits_to_source_periods_1.match_transaction_splits_to_source_periods)(with_categories);
            // Assignment runs in memory inside the upsert (see process_added_transactions).
            const final = with_periods;
            // Transform to new persistence format
            const transactions_for_persistence = mark_hidden_for_removed((0, plaid_3.transform_legacy_to_persistence)(final, ctx.user_id, deps.user_context.group_ids), deps.active_account_ids);
            // Upsert via new repository. Modified txns already exist → merge, never overwrite the
            // user's splits/tags/review/categories (Plaid-Modified-Sync-Preserves-Edits).
            const upsert_result = await repositories_1.transaction_repo.upsert_from_plaid_sync((0, observability_1.create_child_span)(ctx), transactions_for_persistence, ctx.user_id, deps.plaid_item.plaid_item_id, undefined, merge_modified_into_existing_service_1.merge_modified_into_existing, write_opts);
            updated = upsert_result.updated;
            written = upsert_result.written;
            console.log(`[${ctx.trace_id}] Updated ${upsert_result.updated} modified transactions`);
        }
        catch (error) {
            const error_msg = error instanceof Error ? error.message : "Unknown error";
            console.error(`[${ctx.trace_id}] Error updating modified transactions:`, error_msg);
            throw error;
        }
    }
    return { updated, written };
}
//# sourceMappingURL=sync_transactions.orchestrator.js.map