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
 * Assignment-only: it writes the engine-owned split fields but does NOT fan out
 * per-transaction `recompute_budget_spent` jobs — bulk callers (the backfill)
 * run a single authoritative full recompute per budget afterwards, so per-txn
 * scoped recomputes would be redundant. For single, trigger-driven edits use
 * `assign_transaction` (which keeps the scoped fan-out).
 *
 * @module orchestrators/transactions/assign_transactions_batch
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_transactions_batch_orchestrator = assign_transactions_batch_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const assignment_context_resolver_1 = require("../../resolvers/transactions/assignment_context.resolver");
const recurring_matches_resolver_1 = require("../../resolvers/transactions/recurring_matches.resolver");
const compute_transaction_assignment_service_1 = require("../../domain/transactions/compute_transaction_assignment.service");
const merge_assignment_1 = require("./merge_assignment");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const source_period_repo_1 = require("../../repositories/source_period.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
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
    var _a, _b, _c, _d, _e, _f;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "assign_transactions_batch");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        if (input.transaction_ids.length === 0) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { processed: 0, changed: 0, not_found: 0 };
        }
        // Resolve the transaction-independent context ONCE for the whole batch.
        const shared = await (0, assignment_context_resolver_1.resolve_shared_assignment_context)(ctx, input.user_id);
        // Bulk-read the batch's txn docs ONCE (dates come along for free) — replaces the
        // per-transaction `get_raw_by_id` inside resolve_assignment_context AND the old field-masked
        // date probe. Inactive/missing docs are skipped by the repo.
        const now_ms = firestore_1.Timestamp.now().toMillis();
        const txn_docs = await transaction_repo_1.transaction_repo.get_raw_by_ids(ctx, input.transaction_ids);
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
        const scoped = ((_b = (_a = input.candidate_outflow_ids) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0 ||
            ((_d = (_c = input.candidate_inflow_ids) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0) > 0;
        const [preloaded_candidates, overlapping_source_periods] = await Promise.all([
            scoped
                ? (0, recurring_matches_resolver_1.load_recurring_candidates_scoped)(ctx, (_e = input.candidate_outflow_ids) !== null && _e !== void 0 ? _e : [], (_f = input.candidate_inflow_ids) !== null && _f !== void 0 ? _f : [], window_start_ms, window_end_ms)
                : (0, recurring_matches_resolver_1.load_recurring_candidates)(ctx, input.user_id, window_start_ms, window_end_ms),
            source_period_repo_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(span_start_ms), firestore_1.Timestamp.fromMillis(span_end_ms)),
        ]);
        const preloaded_source_periods = overlapping_source_periods.map((p) => ({
            id: p.id,
            type: p.period_type,
            start_ms: p.start_date.toMillis(),
            end_ms: p.end_date.toMillis(),
        }));
        let processed = 0;
        let changed = 0;
        const not_found = input.transaction_ids.length - txn_docs.length;
        const assign_one = async (txn) => {
            const resolved = await (0, assignment_context_resolver_1.resolve_assignment_context)(ctx, input.user_id, txn.id, shared, preloaded_candidates, txn, preloaded_source_periods);
            if (!resolved) {
                return;
            }
            const result = (0, compute_transaction_assignment_service_1.compute_transaction_assignment)(resolved.splits_input, resolved.context);
            const now = firestore_1.Timestamp.now();
            const { updated_splits, name_changed, split_budget_ids, split_outflow_ids, split_inflow_ids } = (0, merge_assignment_1.merge_assignment_onto_raw_splits)(resolved, result, now);
            // Skip-if-unchanged: nothing to write (matches single-item semantics).
            if (!result.changed && !name_changed) {
                processed++;
                return;
            }
            await transaction_repo_1.transaction_repo.apply_split_assignments(ctx, resolved.transaction_doc_id, updated_splits, split_budget_ids, split_outflow_ids, split_inflow_ids);
            processed++;
            if (result.changed) {
                changed++;
            }
        };
        // Process in bounded-concurrency windows.
        for (let i = 0; i < txn_docs.length; i += CONCURRENCY) {
            const window = txn_docs.slice(i, i + CONCURRENCY);
            await Promise.all(window.map((t) => assign_one(t)));
        }
        // Invalidate the derive cache ONCE for the whole batch (TR-2). The engine's split
        // write-back used to re-fire on_transaction_written N times → N version bumps; now a
        // single bump per batch covers all of them (only when something actually changed).
        if (changed > 0) {
            await (0, derive_version_repo_1.bump_derive_version)(input.user_id).catch(() => { });
        }
        console.log(`[${ctx.trace_id}] assign_transactions_batch: user=${input.user_id} ` +
            `processed=${processed} changed=${changed} not_found=${not_found}`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { processed, changed, not_found };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "ASSIGN_TRANSACTIONS_BATCH_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=assign_transactions_batch.orchestrator.js.map