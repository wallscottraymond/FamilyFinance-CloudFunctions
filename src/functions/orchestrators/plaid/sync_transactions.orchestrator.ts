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

import { OrchestratorContext } from "../../types";
import { create_child_span } from "../../observability";
import {
  TransactionSyncInput,
  TransactionSyncResponse,
  TransactionForPersistence,
  PendingMigration,
  TRANSACTION_SYNC_BUDGET,
  PLAID_SYNC_PAGE_DELAY_MS,
} from "../../types/plaid";
import { resolve_transaction_sync_dependencies } from "../../resolvers/plaid";
import {
  identify_pending_migrations,
  extract_removed_transaction_ids,
  transform_legacy_to_persistence,
} from "../../integrations/plaid";
import { sync_transactions } from "../../integrations/plaid";
import {
  validate_transactions_for_sync,
  merge_pending_to_posted,
  aggregate_transaction_sync_results,
  should_continue_sync,
} from "../../domain/plaid";
import {
  transaction_repo,
} from "../../repositories";
import { plaid_item_repo } from "../../repositories/plaid";

// Import pipeline utilities (snake_case versions)
import { format_transactions } from "../../transactions/utils/format_transactions";
import { match_categories_to_transactions } from "../../transactions/utils/match_categories_to_transactions";
import { match_transaction_splits_to_source_periods } from "../../transactions/utils/match_transaction_splits_to_source_periods";
import { assign_transaction_splits_batch } from "../../transactions/utils/assign_transaction_splits";

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
export async function sync_transactions_orchestrator(
  ctx: OrchestratorContext<TransactionSyncInput>
): Promise<TransactionSyncResponse> {
  const start_time = Date.now();
  const errors: string[] = [];

  console.log(
    `[${ctx.trace_id}] Starting transaction sync for user ${ctx.user_id}, item ${ctx.input.item_id}`
  );

  // 1. RESOLVE DEPENDENCIES
  const deps = await resolve_transaction_sync_dependencies(
    create_child_span(ctx),
    {
      item_id: ctx.input.item_id,
      user_id: ctx.user_id,
    }
  );

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
  let next_cursor: string | null = null;

  // 2. PAGINATE THROUGH PLAID SYNC API
  while (has_more && should_continue_sync(errors)) {
    console.log(
      `[${ctx.trace_id}] Fetching transactions page, cursor: ${current_cursor || "initial"}`
    );

    // 2a. CALL PLAID INTEGRATION
    let plaid_response;
    try {
      plaid_response = await sync_transactions(
        deps.plaid_item.access_token,
        current_cursor
      );
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[${ctx.trace_id}] Failed to fetch transactions from Plaid:`,
        error_msg
      );
      errors.push(`Plaid API error: ${error_msg}`);
      break;
    }

    console.log(
      `[${ctx.trace_id}] Plaid sync response: added=${plaid_response.added.length}, ` +
      `modified=${plaid_response.modified.length}, removed=${plaid_response.removed.length}, ` +
      `has_more=${plaid_response.has_more}`
    );

    // 2b. FILTER OUT TRANSACTIONS FOR HIDDEN ACCOUNTS
    // Silently discard transactions for accounts that have been hidden/removed
    const filter_for_active_accounts = (
      transactions: import("plaid").Transaction[]
    ): import("plaid").Transaction[] => {
      const filtered = transactions.filter(
        txn => deps.active_account_ids.has(txn.account_id)
      );
      const discarded = transactions.length - filtered.length;
      if (discarded > 0) {
        console.log(
          `[${ctx.trace_id}] Discarded ${discarded} transactions for hidden accounts`
        );
      }
      return filtered;
    };

    const active_added = filter_for_active_accounts(plaid_response.added);
    const active_modified = filter_for_active_accounts(plaid_response.modified);

    // 2c. PROCESS ADDED TRANSACTIONS (only for active accounts)
    if (active_added.length > 0) {
      try {
        const page_result = await process_added_transactions(
          ctx,
          active_added,
          deps,
          errors
        );
        total_added += page_result.created;
        total_migrated += page_result.migrated;
      } catch (error) {
        const error_msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${ctx.trace_id}] Error processing added transactions:`, error_msg);
        errors.push(`Processing error: ${error_msg}`);
      }
    }

    // 2d. PROCESS MODIFIED TRANSACTIONS (only for active accounts)
    if (active_modified.length > 0) {
      try {
        const modified_result = await process_modified_transactions(
          ctx,
          active_modified,
          deps
        );
        total_modified += modified_result.updated;
      } catch (error) {
        const error_msg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[${ctx.trace_id}] Error processing modified transactions:`, error_msg);
        errors.push(`Modification error: ${error_msg}`);
      }
    }

    // 2e. PROCESS REMOVED TRANSACTIONS
    if (plaid_response.removed.length > 0) {
      try {
        const removed_ids = extract_removed_transaction_ids(plaid_response.removed);
        const remove_results = await transaction_repo.soft_delete_by_plaid_ids(
          create_child_span(ctx),
          ctx.user_id,
          removed_ids,
          "Removed by Plaid sync"
        );
        total_removed += remove_results.length;
        console.log(`[${ctx.trace_id}] Soft-deleted ${remove_results.length} removed transactions`);
      } catch (error) {
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
      await new Promise(resolve => setTimeout(resolve, PLAID_SYNC_PAGE_DELAY_MS));
    }
  }

  // 3. UPDATE CURSOR
  try {
    await plaid_item_repo.update_cursor(
      create_child_span(ctx),
      deps.plaid_item.doc_id,
      next_cursor
    );
  } catch (error) {
    const error_msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[${ctx.trace_id}] Failed to update cursor:`, error_msg);
    errors.push(`Cursor update error: ${error_msg}`);
  }

  // 4. BUILD RESULT
  const duration_ms = Date.now() - start_time;

  console.log(
    `[${ctx.trace_id}] Transaction sync completed in ${duration_ms}ms: ` +
    `added=${total_added}, modified=${total_modified}, removed=${total_removed}, ` +
    `migrated=${total_migrated}, errors=${errors.length}`
  );

  // Check performance budget
  if (duration_ms > TRANSACTION_SYNC_BUDGET.max_time_ms) {
    console.warn(
      `[${ctx.trace_id}] Transaction sync exceeded time budget: ${duration_ms}ms > ${TRANSACTION_SYNC_BUDGET.max_time_ms}ms`
    );
  }

  return aggregate_transaction_sync_results(
    total_added,
    total_modified,
    total_removed,
    total_migrated,
    has_more,
    next_cursor,
    errors.length > 0 ? errors : undefined
  );
}

/**
 * Process added transactions through the 6-step pipeline.
 *
 * This wraps the existing pipeline utilities to maintain compatibility
 * with the current system while fitting into the new architecture.
 */
async function process_added_transactions(
  ctx: OrchestratorContext<TransactionSyncInput>,
  plaid_transactions: import("plaid").Transaction[],
  deps: NonNullable<Awaited<ReturnType<typeof resolve_transaction_sync_dependencies>>>,
  errors: string[]
): Promise<{ created: number; migrated: number }> {
  // Identify pending->posted migrations BEFORE processing
  const migrations = identify_pending_migrations(
    plaid_transactions,
    deps.pending_transactions
  );

  console.log(
    `[${ctx.trace_id}] Identified ${migrations.length} pending->posted migrations`
  );

  // Track IDs that are migrations (to skip normal creation)
  const migration_posted_ids = new Set(migrations.map(m => m.posted_plaid_transaction_id));

  // Filter out migrations from normal processing
  const new_transactions = plaid_transactions.filter(
    txn => !migration_posted_ids.has(txn.transaction_id)
  );

  let created = 0;
  let migrated = 0;

  // Process new transactions through existing pipeline
  if (new_transactions.length > 0) {
    try {
      // Step 1: Format transactions (Plaid -> internal structure)
      const formatted = await format_transactions(
        new_transactions,
        deps.plaid_item.plaid_item_id,
        ctx.user_id,
        deps.user_context.family_id || undefined,
        deps.user_context.currency
      );
      console.log(`[${ctx.trace_id}] Step 1/6: Formatted ${formatted.length} transactions`);

      // Step 2: Match categories
      const with_categories = await match_categories_to_transactions(formatted, ctx.user_id);
      console.log(`[${ctx.trace_id}] Step 2/6: Matched categories`);

      // Step 3: Match source periods
      const with_periods = await match_transaction_splits_to_source_periods(with_categories);
      console.log(`[${ctx.trace_id}] Step 3/6: Matched source periods`);

      // Step 4: Assign budgets (centralized split assignment)
      const assignment_results = await assign_transaction_splits_batch(with_periods, ctx.user_id);
      const with_budgets = assignment_results.map(r => r.transaction);
      console.log(`[${ctx.trace_id}] Step 4/6: Assigned budgets`);

      // Step 5: (legacy outflow matcher removed 2026-06-13) — the engine sets
      // split.outflow_id via on_transaction_written after upsert, and the reconcile
      // engine updates outflow-period paid/received status. No inline matching here.
      const final = with_budgets;

      // Step 6a: Transform legacy format to new persistence format
      const transactions_for_persistence = transform_legacy_to_persistence(
        final,
        ctx.user_id,
        deps.user_context.group_ids
      );
      console.log(`[${ctx.trace_id}] Step 6a: Transformed ${transactions_for_persistence.length} transactions to persistence format`);

      // Step 6b: Upsert transactions via new repository
      const upsert_result = await transaction_repo.upsert_from_plaid_sync(
        create_child_span(ctx),
        transactions_for_persistence,
        ctx.user_id,
        deps.plaid_item.plaid_item_id
      );
      console.log(`[${ctx.trace_id}] Step 6b: Upserted transactions (created=${upsert_result.created}, updated=${upsert_result.updated})`);

      created = upsert_result.created;

    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Pipeline error:`, error_msg);
      errors.push(`Pipeline error: ${error_msg}`);
    }
  }

  // Process migrations separately
  if (migrations.length > 0) {
    try {
      migrated = await process_migrations(ctx, migrations, deps);
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Migration error:`, error_msg);
      errors.push(`Migration error: ${error_msg}`);
    }
  }

  return { created, migrated };
}

/**
 * Process pending->posted migrations.
 *
 * When a pending transaction posts:
 * 1. The posted transaction has a new ID
 * 2. It references the old pending ID via pending_transaction_id
 * 3. We need to migrate user modifications from the pending to the posted
 * 4. Soft-delete the pending transaction
 */
async function process_migrations(
  ctx: OrchestratorContext<TransactionSyncInput>,
  migrations: PendingMigration[],
  deps: NonNullable<Awaited<ReturnType<typeof resolve_transaction_sync_dependencies>>>
): Promise<number> {
  const trace = create_child_span(ctx);
  let migrated = 0;

  for (const migration of migrations) {
    try {
      // Get the posted transaction's Plaid data
      // Note: The posted transaction should already be in the added array
      // but we need to create it with the migrated data

      // Create a minimal posted transaction for merge
      // Note: transform_context would be used here if we needed full transformation
      // In practice, this would come from the Plaid response
      const posted_base: TransactionForPersistence = {
        transaction_id: migration.posted_plaid_transaction_id,
        user_id: ctx.user_id,
        group_ids: deps.user_context.group_ids,
        is_active: true,
        plaid_item_id: deps.plaid_item.plaid_item_id,
        account_id: "", // Will be filled from pending
        amount: migration.new_amount,
        currency: deps.user_context.currency,
        transaction_date: new Date(), // Will be updated
        name: "",
        merchant_name: null,
        is_pending: false,
        pending_transaction_id: migration.pending_plaid_transaction_id,
        type: "expense",
        source: "plaid",
        plaid_primary_category: "",
        plaid_detailed_category: "",
        internal_primary_category: null,
        internal_detailed_category: null,
        splits: [],
        initial_plaid_data: {
          plaid_account_id: "",
          plaid_merchant_name: null,
          plaid_name: "",
          plaid_transaction_id: migration.posted_plaid_transaction_id,
          plaid_pending: false,
        },
      };

      const merged = merge_pending_to_posted(posted_base, migration);

      // Validate
      const validation = validate_transactions_for_sync([merged]);
      if (validation.validation_errors.length > 0) {
        console.warn(
          `[${ctx.trace_id}] Migration validation errors for ${migration.posted_plaid_transaction_id}:`,
          validation.validation_errors
        );
        continue;
      }

      // Update the pending transaction to mark it as posted
      // The actual creation will happen through the normal pipeline
      await transaction_repo.update_transaction_fields(
        trace,
        migration.pending_transaction.doc_id,
        { is_pending: false }
      );

      migrated++;

      console.log(
        `[${ctx.trace_id}] Migrated pending ${migration.pending_plaid_transaction_id} ` +
        `-> posted ${migration.posted_plaid_transaction_id}` +
        (migration.amount_changed ? ` (amount: ${migration.old_amount} -> ${migration.new_amount})` : "")
      );

    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[${ctx.trace_id}] Failed to migrate ${migration.pending_plaid_transaction_id}:`,
        error_msg
      );
    }
  }

  return migrated;
}

/**
 * Process modified transactions.
 *
 * For modified transactions, we only update if there are material changes
 * that affect budget calculations (amount, date, category).
 */
async function process_modified_transactions(
  ctx: OrchestratorContext<TransactionSyncInput>,
  plaid_transactions: import("plaid").Transaction[],
  deps: NonNullable<Awaited<ReturnType<typeof resolve_transaction_sync_dependencies>>>
): Promise<{ updated: number }> {
  let updated = 0;

  // For now, we run modified transactions through the same pipeline as added
  // This ensures categories, periods, and budgets are re-matched

  if (plaid_transactions.length > 0) {
    try {
      // Use the pipeline for updates
      const formatted = await format_transactions(
        plaid_transactions,
        deps.plaid_item.plaid_item_id,
        ctx.user_id,
        deps.user_context.family_id || undefined,
        deps.user_context.currency
      );

      const with_categories = await match_categories_to_transactions(formatted, ctx.user_id);
      const with_periods = await match_transaction_splits_to_source_periods(with_categories);
      const assignment_results = await assign_transaction_splits_batch(with_periods, ctx.user_id);
      const with_budgets = assignment_results.map(r => r.transaction);
      // (legacy outflow matcher removed 2026-06-13) — engine sets outflow_id via
      // on_transaction_written; reconcile updates outflow-period status.
      const final = with_budgets;

      // Transform to new persistence format
      const transactions_for_persistence = transform_legacy_to_persistence(
        final,
        ctx.user_id,
        deps.user_context.group_ids
      );

      // Upsert via new repository
      const upsert_result = await transaction_repo.upsert_from_plaid_sync(
        create_child_span(ctx),
        transactions_for_persistence,
        ctx.user_id,
        deps.plaid_item.plaid_item_id
      );

      updated = upsert_result.updated;
      console.log(`[${ctx.trace_id}] Updated ${upsert_result.updated} modified transactions`);

    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error updating modified transactions:`, error_msg);
      throw error;
    }
  }

  return { updated };
}
