/**
 * Sync Item Orchestrator — THE way a Plaid item is synced (first link, webhooks, crons, manual
 * refresh, re-auth). One writer per item, one write per transaction, one follow-up pass.
 *
 *   1. Lease: at most one sync per item; a request during a sync makes the holder run again.
 *   2. Bills / income FIRST (when Plaid has them and they're due), so the assignment engine's
 *      authoritative stream membership is in place before any transaction is written.
 *   3. Transactions: every page pulled, assigned IN MEMORY, written ONCE (`syncRunId` stamped —
 *      the per-transaction trigger skips them).
 *   4. New streams: their periods generated inline (the create trigger skips sync-stamped
 *      streams), and transactions written BEFORE their stream existed are linked once.
 *   5. ONE follow-up pass: reconcile affected bills/income, recompute affected budget periods,
 *      re-check internal transfers, bump the derive version once.
 *
 * Replaces, for a first link: the bare transaction write + read-back + re-write, ~650
 * recompute-per-day jobs, ~3 reconciles per stream, and a chain of 5-minute sweep waits.
 *
 * @module orchestrators/plaid/sync_item
 */

import { TraceContext } from "../../types";
import { create_child_span } from "../../observability";
import { item_sync_lease_repo, SyncRequest } from "../../repositories/plaid/item_sync_lease.repo";
import { plaid_item_repo } from "../../repositories/plaid";
import { transaction_repo } from "../../repositories";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
import type { RecurringWrittenDoc } from "../../repositories/recurring_doc_equality";
import { is_user_purging } from "../../infrastructure/purge_guard";
import { coalesce_job } from "../../infrastructure/job_queue";
import { sync_transactions_orchestrator } from "./sync_transactions.orchestrator";
import { sync_recurring_orchestrator } from "./sync_recurring.orchestrator";
import { save_item_accounts } from "./save_item_accounts";
import {
  empty_follow_ups,
  follow_ups_from_written,
  merge_follow_ups,
  run_sync_follow_ups,
  SyncFollowUps,
} from "./sync_follow_ups";
import { assign_transactions_batch_orchestrator } from "../transactions/assign_transactions_batch.orchestrator";
import { generate_periods_inline } from "../recurring/generate_periods_inline";

export interface SyncItemInput {
  /** plaid_items document id. */
  item_doc_id: string;
  user_id: string;
  /** Also refresh bills / income this round. */
  recurring?: boolean;
  /** Fallback attempt counter while Plaid's first pull isn't ready. */
  attempt?: number;
  reason?: string;
}

export interface SyncItemResult {
  status: "synced" | "already_running" | "skipped" | "failed";
  rounds: number;
  added: number;
  modified: number;
  removed: number;
  streams_written: number;
  error?: string;
}

/** Plaid's first pull isn't ready: try again on this schedule (webhooks usually beat it). */
const NOT_READY_RETRY_SECONDS = 60;
const MAX_NOT_READY_ATTEMPTS = 10;
const MAX_ROUNDS = 3;

/** Enqueue a sync for an item — every entry point uses this (webhook, link, cron, retry). */
export async function enqueue_item_sync(input: {
  item_doc_id: string;
  user_id: string;
  recurring?: boolean;
  delay_seconds?: number;
  attempt?: number;
  reason?: string;
  trace_id?: string;
}): Promise<void> {
  await coalesce_job(
    "sync_item",
    {
      deduplication_key: `sync_item:${input.item_doc_id}`,
      item_doc_id: input.item_doc_id,
      user_id: input.user_id,
      recurring: !!input.recurring,
      attempt: input.attempt ?? 1,
      reason: input.reason ?? "request",
    },
    {
      // No delay → `on_job_created` runs it immediately (delayed jobs wait for the 5-min sweep).
      delay_seconds: input.delay_seconds ?? 0,
      trace_id: input.trace_id,
      // A recurring request never merges into a pending NON-recurring run (it would drop the
      // recurring refresh — e.g. "Track" on a review item would never create the bill). Anything
      // else merges as before. A deliberate change for all users (D30, approved 2026-10-16): at
      // most one extra sync in a burst.
      can_merge_into: async (pending) => !!pending.recurring || !input.recurring,
    }
  );
}

export async function sync_item_orchestrator(
  ctx: TraceContext,
  input: SyncItemInput
): Promise<SyncItemResult> {
  const run_id = ctx.trace_id;
  const result: SyncItemResult = {
    status: "synced",
    rounds: 0,
    added: 0,
    modified: 0,
    removed: 0,
    streams_written: 0,
  };

  if (await is_user_purging(input.user_id)) {
    return { ...result, status: "skipped", error: "user being deleted" };
  }

  if (!(await item_sync_lease_repo.claim(input.item_doc_id, run_id, { recurring: input.recurring }))) {
    console.log(`[${ctx.trace_id}] sync_item: ${input.item_doc_id} already syncing — it will run again`);
    return { ...result, status: "already_running" };
  }

  let request: SyncRequest | null = { recurring: input.recurring };
  try {
    while (request && result.rounds < MAX_ROUNDS) {
      result.rounds++;
      await run_round(ctx, input, run_id, request, result);
      request = await item_sync_lease_repo.finish_round(input.item_doc_id, run_id);
    }
    if (request) {
      // Still being asked after MAX_ROUNDS — hand the rest to a fresh job.
      await item_sync_lease_repo.release(input.item_doc_id, run_id);
      await enqueue_item_sync({ ...input, recurring: request.recurring, reason: "more_requests", trace_id: ctx.trace_id });
    }
    return result;
  } catch (error) {
    await item_sync_lease_repo.release(input.item_doc_id, run_id).catch(() => {});
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[${ctx.trace_id}] sync_item failed for ${input.item_doc_id}:`, msg);
    throw error; // the job queue retries
  }
}

async function run_round(
  ctx: TraceContext,
  input: SyncItemInput,
  run_id: string,
  request: SyncRequest,
  result: SyncItemResult
): Promise<void> {
  const item = await plaid_item_repo.get_raw_by_id(ctx, input.item_doc_id);
  if (!item || item.data.isActive === false) {
    result.status = "skipped";
    return;
  }
  const never_synced_recurring = !item.data.lastRecurringSyncAt;
  let follow_ups: SyncFollowUps = empty_follow_ups();
  const streams_written: RecurringWrittenDoc[] = [];
  const newly_suppressed = new Set<string>();
  const newly_absorbed = new Set<string>();
  const absorbing = new Map<string, "outflow" | "inflow">();

  const sync_recurring = async (): Promise<boolean> => {
    const r = await sync_recurring_orchestrator(
      {
        ...create_child_span(ctx),
        input: { item_id: input.item_doc_id },
        user_id: input.user_id,
        idempotency_key: `sync_item:${run_id}:recurring`,
      },
      { run_id }
    );
    streams_written.push(...r.written);
    for (const id of r.newly_suppressed_plaid_ids ?? []) newly_suppressed.add(id);
    for (const id of r.newly_absorbed_plaid_ids ?? []) newly_absorbed.add(id);
    for (const a of r.absorbing_records ?? []) absorbing.set(a.id, a.direction);
    // A "Track" whose stream is gone from this item was handed to the user's other items (round 4
    // defect 2): re-sync them now so one with a live stream of the vendor creates the bill.
    for (const other of r.handoff_item_doc_ids ?? []) {
      await enqueue_item_sync({
        item_doc_id: other, user_id: input.user_id, recurring: true, reason: "track_handoff", trace_id: ctx.trace_id,
      }).catch((e) => console.warn(`[${ctx.trace_id}] track hand-off sync of ${other} not enqueued:`, e));
    }
    // A brand-new item's recurring data often isn't ready yet (PRODUCT_NOT_READY) — not an error.
    return r.success !== false;
  };

  // 1. Bills / income first when asked for (webhook) or never done — so stream membership is in
  //    the assignment context before transactions are written.
  let recurring_done = false;
  if (request.recurring || never_synced_recurring) {
    recurring_done = await sync_recurring();
  }

  // 2. Transactions — pulled, assigned in memory, written once.
  const tx_ctx = {
    ...create_child_span(ctx),
    input: { item_id: input.item_doc_id, user_id: input.user_id },
    user_id: input.user_id,
    idempotency_key: `sync_item:${run_id}:transactions`,
  };
  let tx = await sync_transactions_orchestrator(tx_ctx, { run_id, defer_follow_ups: true });
  if (tx.needs_accounts) {
    // An account in this pull isn't saved yet (nothing was written): save the item's accounts
    // and pull again — no transaction is ever dropped for a missing account. Bills fetched above
    // skipped that account's streams, so fetch them again first (still before any transaction
    // is written, so the new account's bill payments are linked on their first write too).
    await save_item_accounts(ctx, item.id, item.data, input.user_id);
    if (request.recurring || never_synced_recurring) {
      recurring_done = await sync_recurring();
    }
    tx = await sync_transactions_orchestrator(tx_ctx, { run_id, defer_follow_ups: true });
  }
  result.added += tx.added_count;
  result.modified += tx.modified_count;
  result.removed += tx.removed_count;
  follow_ups = merge_follow_ups(follow_ups, tx.follow_ups);

  // 3. History just finished and bills were never fetched → fetch them now (Plaid detects
  //    recurring from the full history).
  if (!recurring_done && never_synced_recurring && tx.update_status === "HISTORICAL_UPDATE_COMPLETE") {
    recurring_done = await sync_recurring();
  }

  // 4. New / changed streams: generate periods for new ones inline, link transactions written
  //    before their stream existed, and reconcile them in the follow-up pass.
  if (streams_written.length > 0) {
    result.streams_written += streams_written.length;
    await generate_periods_inline(ctx, input.user_id, streams_written.filter((s) => s.created));
    const relinked = await link_existing_transactions(ctx, input.user_id, run_id, streams_written);
    follow_ups = merge_follow_ups(follow_ups, {
      ...follow_ups_from_written(relinked),
      outflow_ids: streams_written.filter((s) => is_outflow(s)).map((s) => s.id),
      inflow_ids: streams_written.filter((s) => !is_outflow(s)).map((s) => s.id),
      recurring_changed: true,
    });
  }

  // 4b. Payments newly held out of fuzzy bill matching (a suggested / skipped new stream, X3):
  //     re-assign the ones already stored so a merchant guess linking them to an OLD bill is
  //     cleared now (the engine reads the held-out set). Usually none.
  if (newly_suppressed.size > 0) {
    const relinked = await assign_by_plaid_ids(ctx, input.user_id, run_id, [...newly_suppressed]);
    follow_ups = merge_follow_ups(follow_ups, follow_ups_from_written(relinked));
  }

  // 4c. Payments a converted record just absorbed (D42): re-assign the stored ones so the engine's
  //     stream map links them now, and reconcile the absorbing records in the follow-up pass.
  if (newly_absorbed.size > 0) {
    const relinked = await assign_by_plaid_ids(ctx, input.user_id, run_id, [...newly_absorbed]);
    follow_ups = merge_follow_ups(follow_ups, {
      ...follow_ups_from_written(relinked),
      outflow_ids: [...absorbing].filter(([, d]) => d === "outflow").map(([id]) => id),
      inflow_ids: [...absorbing].filter(([, d]) => d === "inflow").map(([id]) => id),
    });
  }

  // 5. ONE follow-up pass for everything this round wrote.
  if (follow_ups.transactions_changed || follow_ups.recurring_changed) {
    await run_sync_follow_ups(ctx, input.user_id, follow_ups);
  }

  // 6. Plaid's first pull not ready yet → try again shortly (its webhook usually arrives first).
  if (tx.success && tx.update_status === "NOT_READY") {
    const attempt = (input.attempt ?? 1) + 1;
    if (attempt <= MAX_NOT_READY_ATTEMPTS) {
      await enqueue_item_sync({
        item_doc_id: input.item_doc_id,
        user_id: input.user_id,
        recurring: !recurring_done,
        delay_seconds: NOT_READY_RETRY_SECONDS,
        attempt,
        reason: "not_ready",
        trace_id: ctx.trace_id,
      });
    }
  }

  if (!tx.success && !tx.needs_accounts) {
    result.status = "failed";
    result.error = tx.error;
  }
}

const is_outflow = (s: RecurringWrittenDoc): boolean => s.kind === "outflow";

/**
 * Transactions a NEW or changed stream claims that may have been written before it existed (an
 * earlier round, or before Plaid finished detecting recurring) — link them once. Ones already
 * linked are left alone (the engine finds nothing to change).
 */
async function link_existing_transactions(
  ctx: TraceContext,
  user_id: string,
  run_id: string,
  streams: RecurringWrittenDoc[]
): Promise<SyncWrittenDoc[]> {
  const before_ids = (s: RecurringWrittenDoc) => new Set((s.before?.transactionIds as string[] | undefined) ?? []);
  const plaid_ids = new Set<string>();
  for (const s of streams) {
    const had = before_ids(s);
    for (const id of (s.after.transactionIds as string[] | undefined) ?? []) {
      if (!had.has(id)) plaid_ids.add(id);
    }
  }
  return assign_by_plaid_ids(ctx, user_id, run_id, [...plaid_ids]);
}

/** Re-assign the user's stored transactions with these Plaid ids in one batch (stamped run). */
async function assign_by_plaid_ids(
  ctx: TraceContext,
  user_id: string,
  run_id: string,
  ids: string[]
): Promise<SyncWrittenDoc[]> {
  if (ids.length === 0) return [];
  const docs = await transaction_repo.get_by_plaid_transaction_ids(ctx, user_id, ids);
  // Ones already carrying the link (written after the stream existed) come back unchanged from
  // the engine and are not re-written (skip-if-unchanged).
  const doc_ids = docs.filter((d) => d.isActive !== false).map((d) => d.id);
  if (doc_ids.length === 0) return [];
  const collected: SyncWrittenDoc[] = [];
  await assign_transactions_batch_orchestrator(ctx, {
    user_id,
    transaction_ids: doc_ids,
    run_id,
    collect_into: collected,
  });
  return collected;
}
