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
 * only on the immediate job trigger (a full 9-minute budget): the 5-minute sweep hands a due job
 * back to it instead of running it.
 *
 * @module orchestrators/transactions/reassign_user
 */
import { TraceContext } from "../../types";
import { ReassignReason, ReassignRun, ReassignScope } from "../../repositories/reassign_run.repo";
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
export declare const PAGE_SIZE = 200;
/** The job type + its single-flight dedup key. */
export declare const REASSIGN_JOB = "reassign_user";
/** One run per (user, scope): a narrower / different scope queued meanwhile isn't swallowed. */
export declare const reassign_dedup_key: (user_id: string, scope?: ReassignScope, dry_run?: boolean) => string;
/** Enqueue a re-assign run for a user. Never drops a request: merges into a QUEUED run with the
 *  same key; if one is RUNNING, queues this one delayed (re-checked when due). */
export declare function enqueue_reassign_user(input: Omit<ReassignUserInput, "run_id">, trace_id: string, delay_seconds?: number): Promise<boolean>;
export declare function reassign_user_orchestrator(ctx: TraceContext, input: ReassignUserInput, now_ms?: () => number): Promise<ReassignUserResult>;
//# sourceMappingURL=reassign_user.orchestrator.d.ts.map