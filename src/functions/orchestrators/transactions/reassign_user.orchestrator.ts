/**
 * Re-assign User Orchestrator — the ONE bounded re-assign engine
 * (Transaction-Integrity-Review 3-R).
 *
 * Every "re-assign this user's transactions" need goes through here: the one-time repair (3-0b),
 * a Plaid code moved to another category (O1), a budget's categories edited (A3b), and an
 * account changing view (H6). Per user:
 *
 *   - walks the transactions in DATE order, a page at a time, from a saved cursor (an
 *     account-scoped run queries only those accounts); reference data (budgets, categories,
 *     streams) is resolved ONCE per invocation and bill / income candidates once per ~9-month
 *     date chunk, not per page;
 *   - carries old category overrides into user picks in memory first (3-0b), so a transaction is
 *     written at most ONCE, and only when something changed (skip-if-unchanged);
 *   - a DRY RUN computes everything and writes only the report (counts, budget moves, samples);
 *   - bounded: a per-run cap (`max_txns`), a time budget per invocation (continues in a new job
 *     from the cursor), and a kill switch (`_config/reassign.enabled = false`) checked per page;
 *   - ONE follow-up pass at the very end (reconcile touched bills, recompute touched budget
 *     periods, one derive bump) — the engine's writes are stamped `assignRunId` so the
 *     transaction trigger doesn't fan out per write.
 *
 * Single-flight WITHOUT dropping requests: a request while one with its key is queued merges into
 * it; a request while ANY real run for the user is RUNNING is queued delayed (re-checked when due),
 * so a change made mid-run is never lost and two runs never write the same user in parallel.
 * A run that keeps throwing is marked "failed" after a few invocations (never retries forever).
 * The run id is fixed at enqueue, so a retried job RESUMES its run from the cursor. Runs execute
 * only on the immediate job trigger (a full 9-minute budget): the 5-minute sweep hands a due job back to it instead of running it.
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
import { coalesce_job, create_job } from "../../infrastructure/job_queue";
import {
  resolve_shared_assignment_context,
} from "../../resolvers/transactions/assignment_context.resolver";
import {
  load_recurring_candidates,
  PreloadedRecurringCandidates,
} from "../../resolvers/transactions/recurring_matches.resolver";
import { transaction_repo } from "../../repositories/transaction.repo";
import { budget_repo } from "../../repositories/budget.repo";
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
/** Start the final follow-up pass in THIS invocation only if this much time has passed at most;
 *  else it gets its own job (it isn't time-budgeted). */
const FOLLOW_UP_START_LIMIT_MS = 2 * 60 * 1000;
/** A run that hasn't saved progress this long is dead (crashed past retries) — not blocking. */
const STALE_RUN_MS = 20 * 60 * 1000;
/** A request while a run with the same key is running is re-checked this much later. */
const RERUN_DELAY_SECONDS = 5 * 60;
const MATCH_MARGIN_MS = 90 * 24 * 60 * 60 * 1000;
/** Bill / income candidates are loaded for this much date range at a time. */
const CANDIDATE_CHUNK_MS = 270 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TXNS = 25_000;
/** Invocations of one run that may throw before the run is marked "failed". */
const MAX_RUN_FAILURES = 3;
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

/** Enqueue a re-assign run for a user. Never drops a request: merges into a QUEUED run with the
 *  same key; if one is RUNNING, queues this one delayed (re-checked when due). */
export async function enqueue_reassign_user(
  input: Omit<ReassignUserInput, "run_id">,
  trace_id: string,
  delay_seconds?: number
): Promise<boolean> {
  const key = reassign_dedup_key(input.user_id, input.scope, input.dry_run === true);
  const running = await blocking_run_exists(input.user_id, key, input.dry_run === true, "");
  const job = await coalesce_job(
    REASSIGN_JOB,
    // The run id is fixed now, so a retried first job resumes the same run.
    { deduplication_key: key, ...input, run_id: generate_id() },
    {
      trace_id,
      delay_seconds: Math.max(delay_seconds ?? 0, running ? RERUN_DELAY_SECONDS : 0),
    }
  );
  return job !== null;
}

/**
 * Does a run block this one from starting? Real runs are single-flight PER USER (whatever their
 * scope): a running run uses the budgets / categories it loaded when its invocation began, so a
 * second real run for the same user in parallel could finish first and then be overwritten with
 * the older view. Serialized, the later run always walks after the earlier one. A dry run (audit,
 * writes nothing) only waits for another dry run with its key.
 */
async function blocking_run_exists(
  user_id: string,
  dedup_key: string,
  dry_run: boolean,
  except_run_id: string
): Promise<boolean> {
  return dry_run
    ? reassign_run_repo.has_running(dedup_key, except_run_id, STALE_RUN_MS)
    : reassign_run_repo.has_running_real_for_user(user_id, except_run_id, STALE_RUN_MS);
}

/** A continuation of a run (its own key — never merges with a NEW request). */
async function continue_run(ctx: TraceContext, run: ReassignRun, delay_seconds = 0): Promise<void> {
  await create_job(
    REASSIGN_JOB,
    { user_id: run.user_id, run_id: run.run_id },
    { trace_id: ctx.trace_id, delay_seconds }
  );
}

export async function reassign_user_orchestrator(
  ctx: TraceContext,
  input: ReassignUserInput,
  now_ms: () => number = Date.now
): Promise<ReassignUserResult> {
  const span = create_span(ctx, "orchestrator", "reassign_user");
  log_operation_start(span, input.user_id);
  const started = now_ms();

  const existing = input.run_id ? await reassign_run_repo.get(input.run_id) : null;
  const run: ReassignRun = existing ?? {
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
    dedup_key: reassign_dedup_key(input.user_id, input.scope, input.dry_run === true),
    walk_done: false,
    invocations: 0,
    started_at: Timestamp.now(),
    updated_at: Timestamp.now(),
  };
  if (run.status !== "running") {
    log_operation_success(span, input.user_id);
    return { run_id: run.run_id, status: run.status, scanned: run.scanned, changed: run.changed };
  }
  // Single-flight: a NEW run waits while another run with its key is running (it re-checks).
  const blocked =
    !existing &&
    (await blocking_run_exists(run.user_id, run.dedup_key, run.dry_run, run.run_id));
  if (blocked) {
    await create_job(
      REASSIGN_JOB,
      { ...input, run_id: run.run_id },
      { trace_id: ctx.trace_id, delay_seconds: RERUN_DELAY_SECONDS }
    );
    log_operation_success(span, input.user_id);
    return { run_id: run.run_id, status: "continuing", scanned: 0, changed: 0 };
  }
  run.invocations++;
  await reassign_run_repo.save(run); // claims the key (status running) before any work

  try {
    const catalog = await load_category_catalog(ctx);
    const account_ids = run.scope.account_ids?.length ? run.scope.account_ids : null;
    const account_filter = account_ids ? new Set(account_ids) : null;
    let follow_ups = run.follow_ups ?? empty_follow_ups();
    // Per-invocation caches (reference data once; candidates per date chunk).
    let shared: Awaited<ReturnType<typeof resolve_shared_assignment_context>> | null = null;
    let candidates: PreloadedRecurringCandidates | null = null;

    while (!run.walk_done) {
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
        {
          from_ms: run.scope.from_ms,
          to_ms: run.scope.to_ms,
          account_ids: account_ids ?? undefined,
        }
      );
      const docs = account_filter
        ? page.docs.filter((d) => account_filter.has(d.data.accountId as string))
        : page.docs;

      // 3-0b in memory: old overrides → user picks, legacy fields cleared. The same transform
      // runs on a conflicted transaction's fresh re-read (the batch's retry).
      const force_write_ids = new Set<string>();
      const extra_fields_by_id = new Map<string, Record<string, unknown>>();
      let picks = 0; // carried by the last `prepare` call
      const prepare = <T extends { id: string; data: Record<string, unknown> }>(d: T): T => {
        picks = 0;
        const b = backfill_legacy_split_categories(
          (d.data.splits as Array<Record<string, unknown>>) ?? [],
          catalog
        );
        const txn_clear = legacy_txn_fields_to_clear(d.data);
        if (!b.changed && Object.keys(txn_clear).length === 0) return d;
        force_write_ids.add(d.id);
        if (Object.keys(txn_clear).length) extra_fields_by_id.set(d.id, txn_clear);
        picks = b.picks_carried;
        return { ...d, data: { ...d.data, ...txn_clear, splits: b.splits } };
      };
      const prepared = docs.map((d) => {
        const p = prepare(d);
        run.picks_carried += picks; // counted on the first read only, not on a retry's re-read
        return p;
      });

      if (prepared.length > 0) {
        shared = shared ?? (await resolve_shared_assignment_context(ctx, run.user_id));
        const dates = prepared.map((d) => (d.data.transactionDate as Timestamp).toMillis());
        const lo = Math.min(...dates) - MATCH_MARGIN_MS;
        const hi = Math.max(...dates) + MATCH_MARGIN_MS;
        if (!candidates || lo < candidates.window_start_ms || hi > candidates.window_end_ms) {
          candidates = await load_recurring_candidates(
            ctx,
            run.user_id,
            lo,
            Math.max(hi, lo + CANDIDATE_CHUNK_MS)
          );
        }
        const written: SyncWrittenDoc[] = [];
        await assign_transactions_batch_orchestrator(ctx, {
          user_id: run.user_id,
          transaction_ids: prepared.map((d) => d.id),
          preloaded_docs: prepared,
          preloaded_shared: shared,
          preloaded_candidates: candidates,
          force_write_ids,
          extra_fields_by_id,
          dry_run: run.dry_run,
          run_id: run.run_id,
          prepare_fresh: prepare,
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
      if (page.exhausted) run.walk_done = true;
      await reassign_run_repo.save(run); // resumable after every page
    }

    if (run.status === "running" && !run.walk_done) {
      // Out of time: continue from the cursor in a new job.
      await reassign_run_repo.save(run);
      await continue_run(ctx, run);
      log_operation_success(span, input.user_id);
      return {
        run_id: run.run_id,
        status: "continuing",
        scanned: run.scanned,
        changed: run.changed,
      };
    }

    // ONE follow-up pass for the whole run (also after a cap / stop — what was written is
    // followed up). It isn't time-budgeted, so a late walk hands it to its own job.
    if (!run.dry_run && run.follow_ups?.transactions_changed) {
      if (run.status === "running" && now_ms() - started > FOLLOW_UP_START_LIMIT_MS) {
        await reassign_run_repo.save(run);
        await continue_run(ctx, run);
        log_operation_success(span, input.user_id);
        return {
          run_id: run.run_id,
          status: "continuing",
          scanned: run.scanned,
          changed: run.changed,
        };
      }
      await run_sync_follow_ups(ctx, run.user_id, run.follow_ups);
    }
    // The repair (backfill) also rebuilds EVERY budget's stored spend, not just the periods of
    // transactions it moved — fixes spend drift on unchanged ones (summaries / widgets).
    if (!run.dry_run && run.reason === "backfill" && run.status === "running") {
      const budgets = await budget_repo.get_by_user_id(ctx, run.user_id);
      if (budgets.length) {
        await create_job(
          "recompute_budget_spent",
          { user_id: run.user_id, budget_ids: budgets.map((b) => b.id) },
          { trace_id: ctx.trace_id }
        );
      }
    }
    if (run.status === "running") run.status = "done";
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
    // The run stays "running" with its last saved cursor; the job's retry (same run id) resumes.
    // Failures are counted on the RUN (a retry can come back as a fresh job — the sweep hands
    // re-assign jobs to the trigger — so the job's own retry count can't bound it): after
    // MAX_RUN_FAILURES the run is "failed", stops blocking its user's other runs, and ends.
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id: input.user_id, error_code: "REASSIGN_USER_FAILED" }
    );
    const saved = await reassign_run_repo.get(run.run_id).catch(() => null);
    if (saved && saved.status === "running") {
      saved.failures = (saved.failures ?? 0) + 1;
      saved.last_error = error instanceof Error ? error.message : String(error);
      if (saved.failures >= MAX_RUN_FAILURES) {
        saved.status = "failed";
        await reassign_run_repo.save(saved);
        console.error(
          `[${ctx.trace_id}] reassign_user ${run.run_id}: failed ${saved.failures}x — giving up`
        );
        return {
          run_id: run.run_id,
          status: "failed",
          scanned: saved.scanned,
          changed: saved.changed,
        };
      }
      await reassign_run_repo.save(saved);
    }
    throw error;
  }
}
