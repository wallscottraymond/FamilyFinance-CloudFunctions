"use strict";
/**
 * Assign Transactions Batch Orchestrator
 *
 * Bulk variant of `assign_transaction`: assigns the splits of MANY of a user's
 * transactions in ONE invocation, resolving the transaction-independent context
 * (budgets + categories) ONCE and reusing it across every transaction. This
 * removes the per-transaction re-read of budgets + the categories collection
 * that dominates a large re-assignment (e.g. the backfill migration).
 *
 * One follow-up per batch: every write is stamped `assignRunId`, so `on_transaction_written`
 * skips the engine's own writes (they used to re-enter it — one assignment job + one
 * recompute-per-day job per write, ~650 jobs on a first link). The batch then runs ONE follow-up
 * pass itself (reconcile touched bills/income, recompute touched budget periods, one derive bump),
 * or hands its writes to a caller that merges them into its own pass (`collect_into`).
 *
 * @module orchestrators/transactions/assign_transactions_batch
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_transactions_batch_orchestrator = assign_transactions_batch_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const job_queue_1 = require("../../infrastructure/job_queue");
const observability_1 = require("../../observability");
const assignment_context_resolver_1 = require("../../resolvers/transactions/assignment_context.resolver");
const recurring_matches_resolver_1 = require("../../resolvers/transactions/recurring_matches.resolver");
const compute_transaction_assignment_service_1 = require("../../domain/transactions/compute_transaction_assignment.service");
const merge_assignment_1 = require("./merge_assignment");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const sync_follow_ups_1 = require("../plaid/sync_follow_ups");
/** Rounds of re-read + retry for transactions whose write lost a race; what still conflicts
 *  after that gets its own batch job (never left un-assigned). */
const CONFLICT_RETRY_ROUNDS = 2;
/**
 * How many transactions to resolve+write concurrently. Bounds open Firestore
 * sockets per invocation while still overlapping the per-transaction I/O.
 */
const CONCURRENCY = 20;
/**
 * Fallback window (relative to now) over which recurring-match candidate periods are loaded ONCE
 * for the whole batch when we can't scope to the batch's own dates (see below). Must comfortably
 * exceed the matcher's ±90d window; older historical txns fall back to a per-transaction query.
 */
const CANDIDATE_LOOKBACK_MS = 400 * 24 * 60 * 60 * 1000;
const CANDIDATE_LOOKAHEAD_MS = 120 * 24 * 60 * 60 * 1000;
/** Matcher half-window: a txn can match a due period within ±90d of its date. */
const MATCH_MARGIN_MS = 90 * 24 * 60 * 60 * 1000;
async function assign_transactions_batch_orchestrator(ctx, input) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "assign_transactions_batch");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        if (input.transaction_ids.length === 0) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { processed: 0, changed: 0, not_found: 0 };
        }
        // Resolve the transaction-independent context ONCE for the whole batch.
        const shared = (_a = input.preloaded_shared) !== null && _a !== void 0 ? _a : (await (0, assignment_context_resolver_1.resolve_shared_assignment_context)(ctx, input.user_id));
        // Bulk-read the batch's txn docs ONCE (dates come along for free) — replaces the
        // per-transaction `get_raw_by_id` inside resolve_assignment_context AND the old field-masked
        // date probe. Inactive/missing docs are skipped by the repo.
        const now_ms = firestore_1.Timestamp.now().toMillis();
        const txn_docs = (_b = input.preloaded_docs) !== null && _b !== void 0 ? _b : (await transaction_repo_1.transaction_repo.get_raw_by_ids(ctx, input.transaction_ids));
        const dates_ms = txn_docs.map((t) => t.data.transactionDate.toMillis());
        // Load recurring-match candidate periods ONCE (outflow_periods/inflow_periods), scoped to the
        // batch's actual txn dates ±90d — ALWAYS (dates are bulk-read; min/max is free). This guarantees
        // every txn's ±90d window is covered by the single preload, so the per-txn `load_*_candidates`
        // FALLBACK never fires. (The old size gate used a fixed now±window for >500-id batches, leaving
        // old expenses uncovered → a per-txn outflow_periods query each = the 1.16M-read top line.)
        let window_start_ms = now_ms - CANDIDATE_LOOKBACK_MS;
        let window_end_ms = now_ms + CANDIDATE_LOOKAHEAD_MS;
        if (dates_ms.length > 0) {
            window_start_ms = Math.min(...dates_ms) - MATCH_MARGIN_MS;
            window_end_ms = Math.max(...dates_ms) + MATCH_MARGIN_MS;
        }
        // Preload the source periods overlapping the batch's date SPAN ONCE (source_periods is a
        // global calendar collection; a per-txn `get_overlapping` here was O(N)/sync). The resolver
        // filters this set to each txn's date in memory.
        const span_start_ms = dates_ms.length ? Math.min(...dates_ms) : now_ms;
        const span_end_ms = dates_ms.length ? Math.max(...dates_ms) : now_ms;
        // When the caller scopes candidates to known streams (recurring-reconcile), read ONLY those
        // streams' periods (read-cost #1); otherwise scan the user's full due-window set (sync path).
        const scoped = ((_d = (_c = input.candidate_outflow_ids) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0) > 0 ||
            ((_f = (_e = input.candidate_inflow_ids) === null || _e === void 0 ? void 0 : _e.length) !== null && _f !== void 0 ? _f : 0) > 0;
        const caller_candidates = input.preloaded_candidates &&
            input.preloaded_candidates.window_start_ms <= window_start_ms &&
            input.preloaded_candidates.window_end_ms >= window_end_ms
            ? input.preloaded_candidates
            : null;
        const [preloaded_candidates, overlapping_source_periods] = await Promise.all([
            caller_candidates
                ? Promise.resolve(caller_candidates)
                : scoped
                    ? (0, recurring_matches_resolver_1.load_recurring_candidates_scoped)(ctx, (_g = input.candidate_outflow_ids) !== null && _g !== void 0 ? _g : [], (_h = input.candidate_inflow_ids) !== null && _h !== void 0 ? _h : [], window_start_ms, window_end_ms)
                    : (0, recurring_matches_resolver_1.load_recurring_candidates)(ctx, input.user_id, window_start_ms, window_end_ms),
            source_period_repo_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(span_start_ms), firestore_1.Timestamp.fromMillis(span_end_ms)),
        ]);
        const preloaded_source_periods = overlapping_source_periods.map((p) => ({
            id: p.id,
            type: p.period_type,
            start_ms: p.start_date.toMillis(),
            end_ms: p.end_date.toMillis(),
        }));
        const run_id = (_j = input.run_id) !== null && _j !== void 0 ? _j : ctx.trace_id;
        const written = [];
        let processed = 0;
        let changed = 0;
        let wrote = 0; // any committed write (assignment or name change) — both feed derive
        let conflicts = 0; // skipped: the doc changed after we read it
        const not_found = input.transaction_ids.length - txn_docs.length;
        /** Returns false when the write lost a race (the doc changed after it was read). */
        const assign_one = async (txn) => {
            var _a, _b;
            const resolved = await (0, assignment_context_resolver_1.resolve_assignment_context)(ctx, input.user_id, txn.id, shared, preloaded_candidates, txn, preloaded_source_periods);
            if (!resolved) {
                return true;
            }
            const result = (0, compute_transaction_assignment_service_1.compute_transaction_assignment)(resolved.splits_input, resolved.context);
            const now = firestore_1.Timestamp.now();
            const { updated_splits, name_changed, split_budget_ids, split_outflow_ids, split_inflow_ids } = (0, merge_assignment_1.merge_assignment_onto_raw_splits)(resolved, result, now);
            const forced = ((_a = input.force_write_ids) === null || _a === void 0 ? void 0 : _a.has(txn.id)) === true;
            const write = result.changed || name_changed || forced;
            // Reported once the outcome is final (a conflicted write is reported by its retry).
            const report = () => {
                if (!input.on_result)
                    return;
                const before_by_split = new Map(resolved.splits_input.map((s) => { var _a; return [s.split_id, (_a = s.monthly_budget_id) !== null && _a !== void 0 ? _a : s.budget_id]; }));
                input.on_result({
                    transaction_id: txn.id,
                    data: txn.data,
                    write,
                    moves: result.splits
                        .filter((s) => before_by_split.get(s.split_id) !== s.monthly_budget_id)
                        .map((s) => {
                        var _a;
                        return ({
                            split_id: s.split_id,
                            before: (_a = before_by_split.get(s.split_id)) !== null && _a !== void 0 ? _a : "unassigned",
                            after: s.monthly_budget_id,
                        });
                    }),
                });
            };
            // Skip-if-unchanged: nothing to write (single-item semantics). A dry run never writes.
            if (!write || input.dry_run) {
                report();
                processed++;
                return true;
            }
            const applied = await transaction_repo_1.transaction_repo.apply_split_assignments(ctx, resolved.transaction_doc_id, updated_splits, split_budget_ids, split_outflow_ids, split_inflow_ids, run_id, (_b = input.extra_fields_by_id) === null || _b === void 0 ? void 0 : _b.get(txn.id), 
            // Never overwrite a write that landed after our read (a user's edit, a sync).
            txn.update_time);
            if (!applied) {
                conflicts++;
                return false;
            }
            report();
            /* eslint-disable @typescript-eslint/naming-convention */
            written.push({
                doc_id: resolved.transaction_doc_id,
                before: txn.data,
                after: Object.assign(Object.assign({}, txn.data), { splits: updated_splits, splitBudgetIds: split_budget_ids, splitOutflowIds: split_outflow_ids, splitInflowIds: split_inflow_ids }),
            });
            /* eslint-enable @typescript-eslint/naming-convention */
            processed++;
            wrote++;
            if (result.changed || forced) {
                changed++;
            }
            return true;
        };
        // Process in bounded-concurrency windows. A write that lost a race (a status tap, a sync
        // landed after our read) is re-read and retried — a stamped spend-only edit never runs the
        // engine itself, so skipping it would leave the transaction on its old assignment.
        let lost = [];
        try {
            let todo = txn_docs;
            for (let round = 0;; round++) {
                lost = [];
                for (let i = 0; i < todo.length; i += CONCURRENCY) {
                    const window = todo.slice(i, i + CONCURRENCY);
                    const ok = await Promise.all(window.map((t) => assign_one(t)));
                    ok.forEach((applied, k) => {
                        if (!applied)
                            lost.push(window[k].id);
                    });
                }
                if (!lost.length || round >= CONFLICT_RETRY_ROUNDS)
                    break;
                const fresh = await transaction_repo_1.transaction_repo.get_raw_by_ids(ctx, lost);
                todo = input.prepare_fresh ? fresh.map(input.prepare_fresh) : fresh;
                processed += lost.length - fresh.length; // gone / deactivated since
            }
            if (lost.length) {
                // Still racing after the retries: its own batch job (fresh read, own retries).
                processed += lost.length;
                await (0, job_queue_1.create_job)("assign_transactions_batch", { user_id: input.user_id, transaction_ids: lost }, { trace_id: ctx.trace_id, delay_seconds: 30 });
            }
        }
        finally {
            // ONE follow-up for the whole batch (the trigger skips these stamped writes). In `finally`
            // so writes that committed before a failure are still followed up (a retry would see them
            // as unchanged and do nothing).
            if (wrote > 0) {
                if (input.collect_into) {
                    input.collect_into.push(...written);
                }
                else {
                    await (0, sync_follow_ups_1.run_sync_follow_ups)(ctx, input.user_id, (0, sync_follow_ups_1.follow_ups_from_written)(written));
                }
            }
        }
        console.log(`[${ctx.trace_id}] assign_transactions_batch: user=${input.user_id} ` +
            `processed=${processed} changed=${changed} not_found=${not_found} conflicts=${conflicts}`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { processed, changed, not_found };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "ASSIGN_TRANSACTIONS_BATCH_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=assign_transactions_batch.orchestrator.js.map