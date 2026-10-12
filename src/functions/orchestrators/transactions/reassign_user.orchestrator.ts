/**
 * Re-assign User Orchestrator — the ONE bounded re-assign engine
 * (Transaction-Integrity-Review 3-R).
 *
 * Every "re-assign this user's transactions" need goes through here: the one-time repair (3-0b),
 * a Plaid code moved to another category (O1), a budget's categories edited (A3b), and an
 * account changing view (H6). Per user:
 *
 *   - walks the transactions in DATE order, a page at a time, from a saved cursor — each page's
 *     reference data (budgets, categories, bills) is loaded once and its recurring candidates
 *     cover only that page's dates (the old backfill batched in doc-id order, so every batch
 *     spanned all history and re-read every bill period);
 *   - carries old category overrides into user picks in memory first (3-0b), so a transaction is
 *     written at most ONCE, and only when something changed (skip-if-unchanged);
 *   - a DRY RUN computes everything and writes only the report (counts, budget moves, samples);
 *   - bounded: a per-run cap (`max_txns`), a time budget per invocation (continues in a new job
 *     from the cursor), and a kill switch (`_config/reassign.enabled = false`) checked per page;
 *   - ONE follow-up pass at the very end (reconcile touched bills, recompute touched budget
 *     periods, one derive bump) — the engine's writes are stamped `assignRunId` so the
 *     transaction trigger doesn't fan out per write.
 *
 * Single-flight per (user, scope): the job is enqueued with dedup key `reassign_user:{uid}[:scope]`
 * and a continuation re-uses it.
 *
 * @module orchestrators/transactions/reassign_user
 */

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  create_span,
  generate_id,
  log_operation_error,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import {
  build_dedup_key,
  create_job,
  create_job_if_not_exists,
} from "../../infrastructure/job_queue";
import { transaction_repo } from "../../repositories/transaction.repo";
import type { SyncWrittenDoc } from "../../repositories/transaction.repo";
import {
  reassign_run_repo,
  ReassignReason,
  ReassignRun,
  ReassignScope,
} from "../../repositories/reassign_run.repo";
import { load_category_catalog } from "../../resolvers/shared/category_catalog.resolver";
import {
  backfill_legacy_split_categories,
  legacy_txn_fields_to_clear,
} from "../../domain/transactions/legacy_category_backfill.service";
import { assign_transactions_batch_orchestrator } from "./assign_transactions_batch.orchestrator";
import {
  empty_follow_ups,
  follow_ups_from_written,
  merge_follow_ups,
  run_sync_follow_ups,
} from "../plaid/sync_follow_ups";

export interface ReassignUserInput {
  user_id: string;
  /** Continue an existing run (set on continuations). */
  run_id?: string;
  reason?: ReassignReason;
  dry_run?: boolean;
  scope?: ReassignScope;
  /** Refuse to touch more than this many transactions in one run (default 25,000). */
  max_txns?: number;
}

export interface ReassignUserResult {
  run_id: string;
  status: ReassignRun["status"] | "continuing";
  scanned: number;
  changed: number;
}

/** Transactions per page (one batch call; contiguous dates). */
export const PAGE_SIZE = 200;
/** Stop starting new pages after this long (job timeout is 9 min; a page must fit in the rest);
 *  a continuation job picks up from the cursor. */
const TIME_BUDGET_MS = 4 * 60 * 1000;
const DEFAULT_MAX_TXNS = 25_000;
const MAX_SAMPLES = 50;

/** The job type + its single-flight dedup key. */
export const REASSIGN_JOB = "reassign_user";
/** One run per (user, scope): a narrower / different scope queued meanwhile isn't swallowed. */
export const reassign_dedup_key = (
  user_id: string,
  scope: ReassignScope = {},
  dry_run = false
): string => {
  const accounts = [...(scope.account_ids ?? [])].sort().join(",");
  const sig = `${accounts}|${scope.from_ms ?? ""}|${scope.to_ms ?? ""}`;
  // A dry run (audit) never swallows — or is swallowed by — a real run.
  const base = dry_run ? `reassign_user_dry:${user_id}` : `reassign_user:${user_id}`;
  return sig === "||" ? base : `${base}:${sig}`;
};

/** Enqueue a re-assign run for a user (single-flight; returns false when one is already queued). */
export async function enqueue_reassign_user(
  input: Omit<ReassignUserInput, "run_id">,
  trace_id: string,
  delay_seconds?: number
): Promise<boolean> {
  const job = await create_job_if_not_exists(
    REASSIGN_JOB,
    {
      deduplication_key: reassign_dedup_key(input.user_id, input.scope, input.dry_run === true),
      ...input,
    },
    { trace_id, delay_seconds }
  );
  return job !== null;
}

export async function reassign_user_orchestrator(
  ctx: TraceContext,
  input: ReassignUserInput,
  now_ms: () => number = Date.now
): Promise<ReassignUserResult> {
  const span = create_span(ctx, "orchestrator", "reassign_user");
  log_operation_start(span, input.user_id);
  const started = now_ms();

  const run: ReassignRun = (input.run_id ? await reassign_run_repo.get(input.run_id) : null) ?? {
    run_id: input.run_id ?? generate_id(),
    user_id: input.user_id,
    reason: input.reason ?? "manual",
    dry_run: input.dry_run === true,
    scope: input.scope ?? {},
    status: "running",
    cursor: null,
    scanned: 0,
    changed: 0,
    picks_carried: 0,
    moves: {},
    samples: [],
    follow_ups: null,
    max_txns: input.max_txns ?? DEFAULT_MAX_TXNS,
    invocations: 0,
    started_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  };
  if (run.status !== "running") {
    log_operation_success(span, input.user_id);
    return { run_id: run.run_id, status: run.status, scanned: run.scanned, changed: run.changed };
  }
  run.invocations++;

  try {
    const catalog = await load_category_catalog(ctx);
    const account_filter = run.scope.account_ids?.length ? new Set(run.scope.account_ids) : null;
    let follow_ups = run.follow_ups ?? empty_follow_ups();
    let finished = false;

    for (;;) {
      if (!(await reassign_run_repo.is_enabled())) {
        run.status = "stopped";
        break;
      }
      if (run.scanned >= run.max_txns) {
        run.status = "capped";
        break;
      }
      if (now_ms() - started > TIME_BUDGET_MS) break; // continue in a new job

      const page = await transaction_repo.get_page_by_date(
        ctx,
        run.user_id,
        run.cursor,
        Math.min(PAGE_SIZE, run.max_txns - run.scanned), // the cap is exact, not per page
        { from_ms: run.scope.from_ms, to_ms: run.scope.to_ms }
      );
      const docs = account_filter
        ? page.docs.filter((d) => account_filter.has(d.data.accountId as string))
        : page.docs;

      // 3-0b in memory: old overrides → user picks, legacy fields cleared.
      const force_write_ids = new Set<string>();
      const extra_fields_by_id = new Map<string, Record<string, unknown>>();
      const prepared = docs.map((d) => {
        const b = backfill_legacy_split_categories(
          (d.data.splits as Array<Record<string, unknown>>) ?? [],
          catalog
        );
        const txn_clear = legacy_txn_fields_to_clear(d.data);
        if (!b.changed && Object.keys(txn_clear).length === 0) return d;
        force_write_ids.add(d.id);
        if (Object.keys(txn_clear).length) extra_fields_by_id.set(d.id, txn_clear);
        run.picks_carried += b.picks_carried;
        return { id: d.id, data: { ...d.data, ...txn_clear, splits: b.splits } };
      });

      if (prepared.length > 0) {
        const written: SyncWrittenDoc[] = [];
        await assign_transactions_batch_orchestrator(ctx, {
          user_id: run.user_id,
          transaction_ids: prepared.map((d) => d.id),
          preloaded_docs: prepared,
          force_write_ids,
          extra_fields_by_id,
          dry_run: run.dry_run,
          run_id: run.run_id,
          collect_into: written,
          on_result: (r) => {
            if (!r.write) return;
            run.changed++;
            for (const m of r.moves) {
              const key = `${m.before}→${m.after}`;
              run.moves[key] = (run.moves[key] ?? 0) + 1;
            }
            if (r.moves.length && run.samples.length < MAX_SAMPLES) {
              const date = r.data.transactionDate as Timestamp | undefined;
              run.samples.push({
                transaction_id: r.transaction_id,
                merchant: ((r.data.merchantName ?? r.data.name) as string | null) ?? null,
                date: date ? new Date(date.toMillis()).toISOString().slice(0, 10) : "",
                before: r.moves.map((m) => m.before).join(","),
                after: r.moves.map((m) => m.after).join(","),
              });
            }
          },
        });
        if (written.length) {
          follow_ups = merge_follow_ups(follow_ups, follow_ups_from_written(written));
        }
      }

      run.scanned += page.docs.length;
      run.cursor = page.last;
      run.follow_ups = follow_ups;
      await reassign_run_repo.save(run); // resumable after every page
      if (page.exhausted) {
        finished = true;
        break;
      }
    }

    if (finished) run.status = "done";

    if (run.status === "running") {
      // Out of time: continue from the cursor in a new job (same dedup key → still single-flight).
      await reassign_run_repo.save(run);
      await create_job(
        REASSIGN_JOB,
        {
          deduplication_key: reassign_dedup_key(run.user_id, run.scope, run.dry_run),
          user_id: run.user_id,
          run_id: run.run_id,
        },
        {
          trace_id: ctx.trace_id,
          dedup_key: build_dedup_key(
            REASSIGN_JOB,
            reassign_dedup_key(run.user_id, run.scope, run.dry_run)
          ),
        }
      );
      log_operation_success(span, input.user_id);
      return {
        run_id: run.run_id,
        status: "continuing",
        scanned: run.scanned,
        changed: run.changed,
      };
    }

    // ONE follow-up pass for the whole run (also after a cap / stop — what was written is
    // followed up). A dry run wrote nothing.
    if (!run.dry_run && run.follow_ups?.transactions_changed) {
      await run_sync_follow_ups(ctx, run.user_id, run.follow_ups);
    }
    await reassign_run_repo.save(run);

    console.log(
      `[${ctx.trace_id}] reassign_user ${run.run_id}: user=${run.user_id} reason=${run.reason} ` +
        `dry_run=${run.dry_run} status=${run.status} scanned=${run.scanned} ` +
        `changed=${run.changed} ` +
        `picks_carried=${run.picks_carried}`
    );
    log_operation_success(span, input.user_id);
    return { run_id: run.run_id, status: run.status, scanned: run.scanned, changed: run.changed };
  } catch (error) {
    // The run stays "running" with its last saved cursor, so the job's retry resumes it.
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "REASSIGN_USER_FAILED" }
    );
    throw error;
  }
}
