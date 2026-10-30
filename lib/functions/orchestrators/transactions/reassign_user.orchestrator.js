"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reassign_dedup_key = exports.REASSIGN_JOB = exports.PAGE_SIZE = void 0;
exports.enqueue_reassign_user = enqueue_reassign_user;
exports.reassign_user_orchestrator = reassign_user_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const assignment_context_resolver_1 = require("../../resolvers/transactions/assignment_context.resolver");
const recurring_matches_resolver_1 = require("../../resolvers/transactions/recurring_matches.resolver");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const budget_repo_1 = require("../../repositories/budget.repo");
const reassign_run_repo_1 = require("../../repositories/reassign_run.repo");
const category_catalog_resolver_1 = require("../../resolvers/shared/category_catalog.resolver");
const legacy_category_backfill_service_1 = require("../../domain/transactions/legacy_category_backfill.service");
const assign_transactions_batch_orchestrator_1 = require("./assign_transactions_batch.orchestrator");
const sync_follow_ups_1 = require("../plaid/sync_follow_ups");
/** Transactions per page (one batch call; contiguous dates). */
exports.PAGE_SIZE = 200;
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
const DEFAULT_MAX_TXNS = 25000;
/** Invocations of one run that may throw before the run is marked "failed". */
const MAX_RUN_FAILURES = 3;
const MAX_SAMPLES = 50;
/** The job type + its single-flight dedup key. */
exports.REASSIGN_JOB = "reassign_user";
/** One run per (user, scope): a narrower / different scope queued meanwhile isn't swallowed. */
const reassign_dedup_key = (user_id, scope = {}, dry_run = false) => {
    var _a, _b, _c;
    const accounts = [...((_a = scope.account_ids) !== null && _a !== void 0 ? _a : [])].sort().join(",");
    const sig = `${accounts}|${(_b = scope.from_ms) !== null && _b !== void 0 ? _b : ""}|${(_c = scope.to_ms) !== null && _c !== void 0 ? _c : ""}`;
    // A dry run (audit) never swallows — or is swallowed by — a real run.
    const base = dry_run ? `reassign_user_dry:${user_id}` : `reassign_user:${user_id}`;
    return sig === "||" ? base : `${base}:${sig}`;
};
exports.reassign_dedup_key = reassign_dedup_key;
/** Enqueue a re-assign run for a user. Never drops a request: merges into a QUEUED run with the
 *  same key; if one is RUNNING, queues this one delayed (re-checked when due). */
async function enqueue_reassign_user(input, trace_id, delay_seconds) {
    const key = (0, exports.reassign_dedup_key)(input.user_id, input.scope, input.dry_run === true);
    const slot = (0, reassign_run_repo_1.reassign_slot_id)(input.user_id, key, input.dry_run === true);
    const running = await reassign_run_repo_1.reassign_run_repo.slot_busy(slot, "", STALE_RUN_MS);
    const job = await (0, job_queue_1.coalesce_job)(exports.REASSIGN_JOB, Object.assign(Object.assign({ deduplication_key: key }, input), { run_id: (0, observability_1.generate_id)() }), {
        trace_id,
        delay_seconds: Math.max(delay_seconds !== null && delay_seconds !== void 0 ? delay_seconds : 0, running ? RERUN_DELAY_SECONDS : 0),
        can_merge_into: not_started,
    });
    return job !== null;
}
/** A queued re-assign request can absorb a new one only while its run hasn't STARTED: a started
 *  run's pending retry resumes from its cursor and wouldn't re-walk the pages it already did. */
const not_started = async (pending) => !pending.run_id || (await reassign_run_repo_1.reassign_run_repo.get(pending.run_id)) === null;
/** A continuation of a run (its own key — never merges with a NEW request). */
async function continue_run(ctx, run, delay_seconds = 0) {
    await (0, job_queue_1.create_job)(exports.REASSIGN_JOB, { user_id: run.user_id, run_id: run.run_id }, { trace_id: ctx.trace_id, delay_seconds });
}
async function reassign_user_orchestrator(ctx, input, now_ms = Date.now) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "reassign_user");
    (0, observability_1.log_operation_start)(span, input.user_id);
    const started = now_ms();
    const existing = input.run_id ? await reassign_run_repo_1.reassign_run_repo.get(input.run_id) : null;
    const run = existing !== null && existing !== void 0 ? existing : {
        run_id: (_a = input.run_id) !== null && _a !== void 0 ? _a : (0, observability_1.generate_id)(),
        user_id: input.user_id,
        reason: (_b = input.reason) !== null && _b !== void 0 ? _b : "manual",
        dry_run: input.dry_run === true,
        scope: (_c = input.scope) !== null && _c !== void 0 ? _c : {},
        status: "running",
        cursor: null,
        scanned: 0,
        changed: 0,
        picks_carried: 0,
        moves: {},
        samples: [],
        follow_ups: null,
        max_txns: (_d = input.max_txns) !== null && _d !== void 0 ? _d : DEFAULT_MAX_TXNS,
        dedup_key: (0, exports.reassign_dedup_key)(input.user_id, input.scope, input.dry_run === true),
        walk_done: false,
        invocations: 0,
        started_at: firestore_1.Timestamp.now(),
        updated_at: firestore_1.Timestamp.now(),
    };
    if (run.status !== "running") {
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { run_id: run.run_id, status: run.status, scanned: run.scanned, changed: run.changed };
    }
    // Single-flight (atomic): claim the run's slot — a run waits while another holds it (it
    // re-checks later). Every invocation claims, so a continuation can't run beside a newer run.
    const slot = (0, reassign_run_repo_1.reassign_slot_id)(run.user_id, run.dedup_key, run.dry_run);
    if (!(await reassign_run_repo_1.reassign_run_repo.claim_slot(slot, run.run_id, STALE_RUN_MS))) {
        if (existing) {
            // A started run (its progress is saved) always gets its own re-check.
            await (0, job_queue_1.create_job)(exports.REASSIGN_JOB, Object.assign(Object.assign({}, input), { run_id: run.run_id }), { trace_id: ctx.trace_id, delay_seconds: RERUN_DELAY_SECONDS });
        }
        else {
            // A NEW run hasn't saved anything: merge into a queued request with its key (if any) so a
            // burst of requests during a long run becomes ONE queued run, not one per re-check.
            await (0, job_queue_1.coalesce_job)(exports.REASSIGN_JOB, Object.assign(Object.assign({}, input), { deduplication_key: run.dedup_key, run_id: run.run_id }), { trace_id: ctx.trace_id, delay_seconds: RERUN_DELAY_SECONDS, can_merge_into: not_started });
        }
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { run_id: run.run_id, status: "continuing", scanned: 0, changed: 0 };
    }
    // An invocation that never recorded its end (killed by the function timeout — it never reached
    // the catch) counts as a failure, so a run that keeps timing out also ends ("failed") instead
    // of re-claiming its slot forever.
    if (existing && run.invocation_open === true) {
        run.failures = ((_e = run.failures) !== null && _e !== void 0 ? _e : 0) + 1;
        run.last_error = "previous invocation ended without finishing (timeout?)";
        if (run.failures >= MAX_RUN_FAILURES) {
            return fail_run(ctx, run, slot);
        }
    }
    run.invocations++;
    run.invocation_open = true;
    await reassign_run_repo_1.reassign_run_repo.save(run);
    try {
        const catalog = await (0, category_catalog_resolver_1.load_category_catalog)(ctx);
        const account_ids = ((_f = run.scope.account_ids) === null || _f === void 0 ? void 0 : _f.length) ? run.scope.account_ids : null;
        const account_filter = account_ids ? new Set(account_ids) : null;
        let follow_ups = (_g = run.follow_ups) !== null && _g !== void 0 ? _g : (0, sync_follow_ups_1.empty_follow_ups)();
        // Per-invocation caches (reference data once; candidates per date chunk).
        let shared = null;
        let candidates = null;
        while (!run.walk_done) {
            if (!(await reassign_run_repo_1.reassign_run_repo.is_enabled())) {
                run.status = "stopped";
                break;
            }
            if (run.scanned >= run.max_txns) {
                run.status = "capped";
                break;
            }
            if (now_ms() - started > TIME_BUDGET_MS)
                break; // continue in a new job
            const page = await transaction_repo_1.transaction_repo.get_page_by_date(ctx, run.user_id, run.cursor, Math.min(exports.PAGE_SIZE, run.max_txns - run.scanned), // the cap is exact, not per page
            {
                from_ms: run.scope.from_ms,
                to_ms: run.scope.to_ms,
                account_ids: account_ids !== null && account_ids !== void 0 ? account_ids : undefined,
            });
            const docs = account_filter
                ? page.docs.filter((d) => account_filter.has(d.data.accountId))
                : page.docs;
            // 3-0b in memory: old overrides → user picks, legacy fields cleared. The same transform
            // runs on a conflicted transaction's fresh re-read (the batch's retry).
            const force_write_ids = new Set();
            const extra_fields_by_id = new Map();
            let picks = 0; // carried by the last `prepare` call
            const prepare = (d) => {
                var _a;
                picks = 0;
                const b = (0, legacy_category_backfill_service_1.backfill_legacy_split_categories)((_a = d.data.splits) !== null && _a !== void 0 ? _a : [], catalog);
                const txn_clear = (0, legacy_category_backfill_service_1.legacy_txn_fields_to_clear)(d.data);
                if (!b.changed && Object.keys(txn_clear).length === 0)
                    return d;
                force_write_ids.add(d.id);
                if (Object.keys(txn_clear).length)
                    extra_fields_by_id.set(d.id, txn_clear);
                picks = b.picks_carried;
                return Object.assign(Object.assign({}, d), { data: Object.assign(Object.assign(Object.assign({}, d.data), txn_clear), { splits: b.splits }) });
            };
            const prepared = docs.map((d) => {
                const p = prepare(d);
                run.picks_carried += picks; // counted on the first read only, not on a retry's re-read
                return p;
            });
            if (prepared.length > 0) {
                shared = shared !== null && shared !== void 0 ? shared : (await (0, assignment_context_resolver_1.resolve_shared_assignment_context)(ctx, run.user_id));
                const dates = prepared.map((d) => d.data.transactionDate.toMillis());
                const lo = Math.min(...dates) - MATCH_MARGIN_MS;
                const hi = Math.max(...dates) + MATCH_MARGIN_MS;
                if (!candidates || lo < candidates.window_start_ms || hi > candidates.window_end_ms) {
                    candidates = await (0, recurring_matches_resolver_1.load_recurring_candidates)(ctx, run.user_id, lo, Math.max(hi, lo + CANDIDATE_CHUNK_MS));
                }
                const written = [];
                try {
                    await (0, assign_transactions_batch_orchestrator_1.assign_transactions_batch_orchestrator)(ctx, {
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
                            var _a, _b, _c;
                            if (!r.write)
                                return;
                            run.changed++;
                            for (const m of r.moves) {
                                const key = `${m.before}→${m.after}`;
                                run.moves[key] = ((_a = run.moves[key]) !== null && _a !== void 0 ? _a : 0) + 1;
                            }
                            if (r.moves.length && run.samples.length < MAX_SAMPLES) {
                                const date = r.data.transactionDate;
                                run.samples.push({
                                    transaction_id: r.transaction_id,
                                    merchant: (_c = ((_b = r.data.merchantName) !== null && _b !== void 0 ? _b : r.data.name)) !== null && _c !== void 0 ? _c : null,
                                    date: date ? new Date(date.toMillis()).toISOString().slice(0, 10) : "",
                                    before: r.moves.map((m) => m.before).join(","),
                                    after: r.moves.map((m) => m.after).join(","),
                                });
                            }
                        },
                    });
                }
                finally {
                    // Writes that committed before a failure are followed up too: they're stamped (the
                    // trigger skips them) and a retry sees them as unchanged, so nothing else would.
                    if (written.length) {
                        follow_ups = (0, sync_follow_ups_1.merge_follow_ups)(follow_ups, (0, sync_follow_ups_1.follow_ups_from_written)(written));
                    }
                    run.follow_ups = follow_ups;
                }
            }
            run.scanned += page.docs.length;
            run.cursor = page.last;
            run.follow_ups = follow_ups;
            if (page.exhausted)
                run.walk_done = true;
            await reassign_run_repo_1.reassign_run_repo.save(run); // resumable after every page
            // Heartbeat; if the slot was lost (we went stale), stop and continue later.
            if (!(await reassign_run_repo_1.reassign_run_repo.claim_slot(slot, run.run_id, STALE_RUN_MS)))
                break;
        }
        if (run.status === "running" && !run.walk_done) {
            // Out of time: continue from the cursor in a new job.
            run.invocation_open = false;
            await reassign_run_repo_1.reassign_run_repo.save(run);
            await continue_run(ctx, run);
            (0, observability_1.log_operation_success)(span, input.user_id);
            return {
                run_id: run.run_id,
                status: "continuing",
                scanned: run.scanned,
                changed: run.changed,
            };
        }
        // ONE follow-up pass for the whole run (also after a cap / stop — what was written is
        // followed up). It isn't time-budgeted, so a late walk hands it to its own job.
        if (!run.dry_run && ((_h = run.follow_ups) === null || _h === void 0 ? void 0 : _h.transactions_changed)) {
            if (run.status === "running" && now_ms() - started > FOLLOW_UP_START_LIMIT_MS) {
                run.invocation_open = false;
                await reassign_run_repo_1.reassign_run_repo.save(run);
                await continue_run(ctx, run);
                (0, observability_1.log_operation_success)(span, input.user_id);
                return {
                    run_id: run.run_id,
                    status: "continuing",
                    scanned: run.scanned,
                    changed: run.changed,
                };
            }
            await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, run.user_id, run.follow_ups);
        }
        // The repair (backfill) also rebuilds EVERY budget's stored spend, not just the periods of
        // transactions it moved — fixes spend drift on unchanged ones (summaries / widgets).
        if (!run.dry_run && run.reason === "backfill" && run.status === "running") {
            const budgets = await budget_repo_1.budget_repo.get_by_user_id(ctx, run.user_id);
            if (budgets.length) {
                await (0, job_queue_1.create_job)("recompute_budget_spent", { user_id: run.user_id, budget_ids: budgets.map((b) => b.id) }, { trace_id: ctx.trace_id });
            }
        }
        if (run.status === "running")
            run.status = "done";
        run.invocation_open = false;
        await reassign_run_repo_1.reassign_run_repo.save(run);
        await reassign_run_repo_1.reassign_run_repo.release_slot(slot, run.run_id); // the user's next run may start
        console.log(`[${ctx.trace_id}] reassign_user ${run.run_id}: user=${run.user_id} reason=${run.reason} ` +
            `dry_run=${run.dry_run} status=${run.status} scanned=${run.scanned} ` +
            `changed=${run.changed} ` +
            `picks_carried=${run.picks_carried}`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { run_id: run.run_id, status: run.status, scanned: run.scanned, changed: run.changed };
    }
    catch (error) {
        // The run stays "running" with its last saved cursor; the job's retry (same run id) resumes.
        // Failures are counted on the RUN (a retry can come back as a fresh job — the sweep hands
        // re-assign jobs to the trigger — so the job's own retry count can't bound it): after
        // MAX_RUN_FAILURES the run is "failed", stops blocking its user's other runs, and ends.
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "REASSIGN_USER_FAILED" });
        // Bookkeeping never masks the original error.
        try {
            const saved = await reassign_run_repo_1.reassign_run_repo.get(run.run_id);
            if (saved && saved.status === "running") {
                saved.failures = ((_j = saved.failures) !== null && _j !== void 0 ? _j : 0) + 1;
                saved.last_error = error instanceof Error ? error.message : String(error);
                saved.invocation_open = false; // ended (by an error) — recorded
                // The in-memory follow-ups include this invocation's committed writes (the saved cursor
                // doesn't move past the failed page, so counters stay as saved).
                saved.follow_ups = (_k = run.follow_ups) !== null && _k !== void 0 ? _k : saved.follow_ups;
                if (saved.failures >= MAX_RUN_FAILURES)
                    return await fail_run(ctx, saved, slot);
                await reassign_run_repo_1.reassign_run_repo.save(saved);
            }
        }
        catch (bookkeeping_error) {
            console.error(`[${ctx.trace_id}] reassign_user ${run.run_id}: failure bookkeeping failed:`, bookkeeping_error);
        }
        throw error;
    }
}
/**
 * End a run as "failed" (it threw / timed out MAX_RUN_FAILURES times): save it, free its slot,
 * follow up what it DID write (bills, budget spend, derive cache), and alert. Its request is not
 * re-queued (that would retry forever); the assignment audit reports what it left unfixed.
 */
async function fail_run(ctx, run, slot) {
    var _a;
    run.status = "failed";
    run.invocation_open = false;
    await reassign_run_repo_1.reassign_run_repo.save(run);
    await reassign_run_repo_1.reassign_run_repo.release_slot(slot, run.run_id).catch(() => { });
    if (!run.dry_run && ((_a = run.follow_ups) === null || _a === void 0 ? void 0 : _a.transactions_changed)) {
        await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, run.user_id, run.follow_ups).catch((e) => console.error(`[${ctx.trace_id}] reassign_user ${run.run_id}: follow-up failed:`, e));
    }
    console.error(`[${ctx.trace_id}] REASSIGN_RUN_FAILED ${run.run_id}: user=${run.user_id} ` +
        `reason=${run.reason} failures=${run.failures} error=${run.last_error}`);
    return { run_id: run.run_id, status: "failed", scanned: run.scanned, changed: run.changed };
}
//# sourceMappingURL=reassign_user.orchestrator.js.map