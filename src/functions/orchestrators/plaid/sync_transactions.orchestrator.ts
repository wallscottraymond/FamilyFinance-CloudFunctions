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

import { load_category_catalog } from "../../resolvers/shared/category_catalog.resolver";
import { resolve_split_category } from "../../domain/transactions/split_category.service";
import { OrchestratorContext } from "../../types";
import { create_child_span } from "../../observability";
import {
  TransactionSyncInput,
  TransactionSyncResponse,
  TRANSACTION_SYNC_BUDGET,
  PLAID_SYNC_PAGE_DELAY_MS,
  TransactionForPersistence,
} from "../../types/plaid";
import { rules_repo } from "../../repositories/rules.repo";
import { evaluate_rules } from "../../domain/rules/rule_evaluation.service";
import {
  apply_rule_intents,
  only_known_categories,
  with_income_category,
} from "../../domain/rules/rule_application.service";
import { resolve_transaction_sync_dependencies } from "../../resolvers/plaid";
import {
  identify_pending_migrations,
  extract_removed_transaction_ids,
  transform_legacy_to_persistence,
} from "../../integrations/plaid";
import { sync_transactions } from "../../integrations/plaid";
import {
  merge_pending_to_posted,
  aggregate_transaction_sync_results,
} from "../../domain/plaid";
import {
  transaction_repo,
} from "../../repositories";
import type { SyncWrittenDoc, SyncWriteOptions } from "../../repositories/transaction.repo";
import { create_in_memory_assigner } from "../transactions/assign_in_memory";
import {
  empty_follow_ups,
  follow_ups_from_written,
  run_sync_follow_ups,
  SyncFollowUps,
} from "./sync_follow_ups";
import { plaid_item_repo } from "../../repositories/plaid";

// Import pipeline utilities (snake_case versions)
import { format_transactions } from "../../transactions/utils/format_transactions";
import { match_transaction_splits_to_source_periods } from "../../transactions/utils/match_transaction_splits_to_source_periods";
import {
  merge_modified_into_existing,
} from "../../domain/plaid/merge_modified_into_existing.service";

export interface SyncTransactionsOptions {
  /** Stamped on every written doc (`syncRunId`); defaults to the trace id. */
  run_id?: string;
  /** The caller (sync_item) runs the follow-ups once, merged with the recurring sync's. */
  defer_follow_ups?: boolean;
}

export interface TransactionSyncResult extends TransactionSyncResponse {
  /** Plaid's `transactions_update_status` (NOT_READY / INITIAL_UPDATE_COMPLETE / HISTORICAL_UPDATE_COMPLETE). */
  update_status?: string;
  /** An account in this pull isn't saved yet — nothing was written; save accounts and re-sync. */
  needs_accounts?: boolean;
  follow_ups: SyncFollowUps;
}

interface FetchedPages {
  added: import("plaid").Transaction[];
  modified: import("plaid").Transaction[];
  removed: import("plaid").RemovedTransaction[];
  next_cursor: string | null;
  update_status: string;
}

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
  ctx: OrchestratorContext<TransactionSyncInput>,
  opts?: SyncTransactionsOptions
): Promise<TransactionSyncResult> {
  const start_time = Date.now();
  const errors: string[] = [];
  const run_id = opts?.run_id ?? ctx.trace_id;

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
      follow_ups: empty_follow_ups(),
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
      follow_ups: empty_follow_ups(),
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
    console.warn(
      `[${ctx.trace_id}] ${unknown_accounts.length} account(s) not saved yet — deferring the sync ` +
      `(no writes, cursor unchanged): ${unknown_accounts.join(",")}`
    );
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
      follow_ups: empty_follow_ups(),
    };
  }
  const is_active = (t: import("plaid").Transaction) => deps.active_account_ids.has(t.account_id);
  const active_added = fetched.added.filter(is_active);
  const active_modified = fetched.modified.filter(is_active);
  const skipped = all_txns.length - active_added.length - active_modified.length;
  if (skipped > 0) {
    console.log(`[${ctx.trace_id}] Skipped ${skipped} transactions for hidden accounts`);
  }

  // Load the user's active rules ONCE per sync (first-write-only transform on new docs).
  const active_rules = await rules_repo.get_active_rules(create_child_span(ctx), ctx.user_id);
  // A rule's category condition compares the transaction's FIRST category (canon M7) — from the
  // ONE category function over the module-cached catalog.
  const catalog = active_rules.length > 0 ? await load_category_catalog(ctx) : null;
  // "Mark as income" → the income category (Plaid's "other income" → our first category).
  const income_slug = catalog
    ? resolve_split_category(
      { plaid_detailed: "INCOME_OTHER_INCOME", merchant_name: null, name: null },
      catalog
    ).first_category_id ?? null
    : null;
  const on_create =
    active_rules.length > 0 && catalog
      ? (t: TransactionForPersistence): TransactionForPersistence =>
        apply_rule_intents(
          t,
          only_known_categories(with_income_category(evaluate_rules(
            {
              ...t,
              account_labels: deps.account_labels?.get(t.account_id) ?? [],
              first_category_id: resolve_split_category(
                {
                  plaid_detailed: t.plaid_detailed_category || null,
                  merchant_name: t.merchant_name,
                  name: t.name,
                },
                catalog
              ).first_category_id,
            },
            active_rules
          ), income_slug), (slug) => slug in catalog.plaid_by_first)
        )
      : undefined;

  // 3. ASSIGN IN MEMORY, WRITE ONCE. The engine's shared context (budgets, categories, the
  // authoritative bill/income stream membership) + date-span preloads are read once; every
  // transaction is then written with its final assignment and stamped with this run's id, so
  // `on_transaction_written` skips it and this sync does ONE follow-up pass instead.
  const written: SyncWrittenDoc[] = [];
  let write_opts: SyncWriteOptions = { run_id };
  const dated = [...active_added, ...active_modified];
  if (dated.length > 0) {
    const times = dated.map((t) => new Date(t.date).getTime()).filter((n) => !isNaN(n));
    const assign = await create_in_memory_assigner(
      create_child_span(ctx),
      ctx.user_id,
      Math.min(...times),
      Math.max(...times) + 24 * 60 * 60 * 1000
    );
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
    } catch (error) {
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
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error processing modified transactions:`, error_msg);
      errors.push(`Modification error: ${error_msg}`);
      // Chunks that committed before the failure are still followed up.
      written.push(...((error as { partial_written?: SyncWrittenDoc[] }).partial_written ?? []));
    }
  }

  if (fetched.removed.length > 0) {
    try {
      const removed_ids = extract_removed_transaction_ids(fetched.removed);
      const remove_results = await transaction_repo.soft_delete_by_plaid_ids(
        create_child_span(ctx),
        ctx.user_id,
        removed_ids,
        "Removed by Plaid sync",
        { run_id, written }
      );
      total_removed += remove_results.length;
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error processing removed transactions:`, error_msg);
      errors.push(`Removal error: ${error_msg}`);
    }
  }

  // 4. FOLLOW-UPS: what this sync's writes affect (before ∪ after) — budgets by date, and the
  // bills/income whose payments changed. Run once, here or by the caller (sync_item merges them
  // with the recurring sync's).
  const follow_ups = follow_ups_from_written(written);
  if (written.length > 0) {
    if (opts?.defer_follow_ups) {
      // Caller runs them (and bumps the derive version once).
    } else {
      await run_sync_follow_ups(ctx, ctx.user_id, follow_ups);
    }
  }

  // 5. CURSOR — only when every page was processed cleanly; never a null cursor. On an error the
  // cursor stays where it was so the next sync re-delivers (upserts are idempotent).
  if (errors.length === 0 && fetched.next_cursor) {
    try {
      await plaid_item_repo.update_cursor(create_child_span(ctx), deps.plaid_item.doc_id, fetched.next_cursor);
    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Failed to update cursor:`, error_msg);
      errors.push(`Cursor update error: ${error_msg}`);
    }
  }

  const duration_ms = Date.now() - start_time;
  console.log(
    `[${ctx.trace_id}] Transaction sync completed in ${duration_ms}ms: ` +
    `added=${total_added}, modified=${total_modified}, removed=${total_removed}, ` +
    `migrated=${total_migrated}, status=${fetched.update_status}, errors=${errors.length}`
  );
  if (duration_ms > TRANSACTION_SYNC_BUDGET.max_time_ms) {
    console.warn(
      `[${ctx.trace_id}] Transaction sync exceeded time budget: ${duration_ms}ms > ${TRANSACTION_SYNC_BUDGET.max_time_ms}ms`
    );
  }

  return {
    ...aggregate_transaction_sync_results(
      total_added,
      total_modified,
      total_removed,
      total_migrated,
      false,
      fetched.next_cursor,
      errors.length > 0 ? errors : undefined
    ),
    update_status: fetched.update_status,
    follow_ups,
  };
}

/** Pull every page from `start_cursor`; restart (max 3×) on a mutation-during-pagination error. */
async function fetch_all_pages(
  ctx: OrchestratorContext<TransactionSyncInput>,
  access_token: string,
  start_cursor: string | null
): Promise<FetchedPages | { error: string }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const added: import("plaid").Transaction[] = [];
    const modified: import("plaid").Transaction[] = [];
    const removed: import("plaid").RemovedTransaction[] = [];
    let cursor = start_cursor;
    let next_cursor: string | null = null;
    let update_status = "UNKNOWN";
    let has_more = true;
    let restart = false;
    while (has_more) {
      let page;
      try {
        page = await sync_transactions(access_token, cursor);
      } catch (error) {
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
      update_status = String(page.transactions_update_status ?? "UNKNOWN");
      if (has_more) await new Promise((r) => setTimeout(r, PLAID_SYNC_PAGE_DELAY_MS));
    }
    if (restart) continue;
    console.log(
      `[${ctx.trace_id}] Plaid pull: added=${added.length}, modified=${modified.length}, ` +
      `removed=${removed.length}, status=${update_status}`
    );
    return { added, modified, removed, next_cursor, update_status };
  }
  return { error: "Plaid data kept changing during the pull" };
}

function plaid_error_code(error: unknown): string | null {
  const data = (error as { response?: { data?: { error_code?: string } } })?.response?.data;
  return data?.error_code ?? null;
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
  errors: string[],
  on_create: ((txn: TransactionForPersistence) => TransactionForPersistence) | undefined,
  write_opts: SyncWriteOptions
): Promise<{ created: number; migrated: number; written: SyncWrittenDoc[] }> {
  // Identify pending->posted migrations BEFORE processing
  const migrations = identify_pending_migrations(
    plaid_transactions,
    deps.pending_transactions
  );

  console.log(
    `[${ctx.trace_id}] Identified ${migrations.length} pending->posted migrations`
  );

  // Migrations are processed through the SAME pipeline as new transactions (so the
  // posted txn gets its real Plaid data — name/account/date/category), then we OVERLAY
  // the pending's user splits (budget + outflow/inflow link + denorm arrays + categories
  // + tags) onto the posted so a user's manual assignment on a PENDING txn survives the
  // pending->posted resync. The pending itself is soft-deleted via Plaid's `removed` array.
  const migration_by_posted = new Map(
    migrations.map((m) => [m.posted_plaid_transaction_id, m])
  );

  let created = 0;
  let migrated = 0;
  let written: SyncWrittenDoc[] = [];

  // Process all synced transactions through the existing pipeline (P2-13: the
  // `new_transactions` alias for `plaid_transactions` was redundant — inlined).
  if (plaid_transactions.length > 0) {
    try {
      // Step 1: Format transactions (Plaid -> internal structure)
      const formatted = await format_transactions(
        plaid_transactions,
        deps.plaid_item.plaid_item_id,
        ctx.user_id,
        deps.user_context.family_id || undefined,
        deps.user_context.currency
      );
      console.log(`[${ctx.trace_id}] Step 1/6: Formatted ${formatted.length} transactions`);

      // Step 2: categories are NOT rewritten here — Plaid's codes are immutable (canon M1); the
      // collection's merchant / keyword rules apply in the ONE category function (M7) at assign.
      const with_categories = formatted;

      // Step 3: Match source periods
      const with_periods = await match_transaction_splits_to_source_periods(with_categories);
      console.log(`[${ctx.trace_id}] Step 3/6: Matched source periods`);

      // Step 4: budget / bill / income assignment — the Transaction Assignment Engine runs IN
      // MEMORY inside the upsert (`write_opts.before_write`), so each transaction is written
      // once, already assigned (no bare write + read-back + second write).
      const final = with_periods;

      // Step 6a: Transform legacy format to new persistence format
      let transactions_for_persistence = transform_legacy_to_persistence(
        final,
        ctx.user_id,
        deps.user_context.group_ids
      );

      // Step 6a-migrate: for each pending->posted migration, OVERLAY the pending's
      // user splits onto the posted txn (merge_pending_to_posted preserves budget +
      // outflow/inflow assignment + categories/tags, and proportionally rescales if the
      // amount changed). Now the posted base has real Plaid data (unlike the old stub).
      if (migration_by_posted.size > 0) {
        transactions_for_persistence = transactions_for_persistence.map((t) => {
          const m = migration_by_posted.get(t.transaction_id);
          return m ? merge_pending_to_posted(t, m) : t;
        });
        migrated = transactions_for_persistence.filter((t) =>
          migration_by_posted.has(t.transaction_id)
        ).length;
      }
      console.log(`[${ctx.trace_id}] Step 6a: Transformed ${transactions_for_persistence.length} transactions (${migrated} inherited splits from a posted pending)`);

      // Step 6b: Upsert transactions via new repository. The `on_create` hook (the Rules Engine)
      // applies ONLY to genuinely-new docs inside upsert's create branch (first-write-only). A
      // posted transaction that INHERITED its pending's splits is a new doc (new Plaid id) but not
      // a new transaction: the rules already ran on the pending, and the user may have edited it
      // since — re-running them would overwrite those edits. So it skips the rules.
      const on_create_new_only = on_create
        ? (t: TransactionForPersistence): TransactionForPersistence =>
          migration_by_posted.has(t.transaction_id) ? t : on_create(t)
        : undefined;
      const upsert_result = await transaction_repo.upsert_from_plaid_sync(
        create_child_span(ctx),
        transactions_for_persistence,
        ctx.user_id,
        deps.plaid_item.plaid_item_id,
        on_create_new_only,
        // Existing doc → keep the user's edits, refresh only Plaid's fields.
        merge_modified_into_existing,
        write_opts
      );
      written = upsert_result.written;
      console.log(`[${ctx.trace_id}] Step 6b: Upserted transactions (created=${upsert_result.created}, updated=${upsert_result.updated})`);

      // New creations exclude the migrated posted txns (they replace a pending, not net-new).
      created = Math.max(0, upsert_result.created - migrated);

    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Pipeline error:`, error_msg);
      errors.push(`Pipeline error: ${error_msg}`);
      // Chunks that committed before the failure are still followed up.
      written = (error as { partial_written?: SyncWrittenDoc[] }).partial_written ?? [];
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
async function process_modified_transactions(
  ctx: OrchestratorContext<TransactionSyncInput>,
  plaid_transactions: import("plaid").Transaction[],
  deps: NonNullable<Awaited<ReturnType<typeof resolve_transaction_sync_dependencies>>>,
  write_opts: SyncWriteOptions
): Promise<{ updated: number; written: SyncWrittenDoc[] }> {
  let updated = 0;
  let written: SyncWrittenDoc[] = [];

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

      const with_categories = formatted; // Plaid codes immutable (M1); rules apply in M7
      const with_periods = await match_transaction_splits_to_source_periods(with_categories);
      // Assignment runs in memory inside the upsert (see process_added_transactions).
      const final = with_periods;

      // Transform to new persistence format
      const transactions_for_persistence = transform_legacy_to_persistence(
        final,
        ctx.user_id,
        deps.user_context.group_ids
      );

      // Upsert via new repository. Modified txns already exist → merge, never overwrite the
      // user's splits/tags/review/categories (Plaid-Modified-Sync-Preserves-Edits).
      const upsert_result = await transaction_repo.upsert_from_plaid_sync(
        create_child_span(ctx),
        transactions_for_persistence,
        ctx.user_id,
        deps.plaid_item.plaid_item_id,
        undefined,
        merge_modified_into_existing,
        write_opts
      );

      updated = upsert_result.updated;
      written = upsert_result.written;
      console.log(`[${ctx.trace_id}] Updated ${upsert_result.updated} modified transactions`);

    } catch (error) {
      const error_msg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[${ctx.trace_id}] Error updating modified transactions:`, error_msg);
      throw error;
    }
  }

  return { updated, written };
}
