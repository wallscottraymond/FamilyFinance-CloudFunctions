"use strict";
/**
 * In-memory assignment — run the Transaction Assignment Engine on a transaction doc BEFORE it is
 * written, so a sync writes each transaction once, already assigned (budgets per lens, bill /
 * income link, app categories, source periods).
 *
 * Same engine + same resolvers as `assign_transactions_batch` (single source of truth for the
 * rules); the only difference is the doc comes from memory instead of a read, and the result is
 * returned instead of written. The transaction-independent context (budgets, categories, the
 * authoritative recurring-stream membership) and the date-span preloads (recurring candidate
 * periods, source periods) are read ONCE per sync.
 *
 * Before (2026-10): the sync wrote transactions bare, `on_transaction_written` queued an
 * assignment job, and that job read every transaction back and wrote it a second time — then the
 * engine's writes re-fired the trigger and queued a recompute per transaction-day (~650 jobs for
 * one 3,000-transaction first link).
 *
 * @module orchestrators/transactions/assign_in_memory
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_in_memory_assigner = create_in_memory_assigner;
const firestore_1 = require("firebase-admin/firestore");
const assignment_context_resolver_1 = require("../../resolvers/transactions/assignment_context.resolver");
const recurring_matches_resolver_1 = require("../../resolvers/transactions/recurring_matches.resolver");
const compute_transaction_assignment_service_1 = require("../../domain/transactions/compute_transaction_assignment.service");
const merge_assignment_1 = require("./merge_assignment");
const source_period_repo_1 = require("../../repositories/source_period.repo");
/** Matcher half-window: a txn can match a due period within ±90d of its date. */
const MATCH_MARGIN_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * Build an assigner for one user's batch of transactions dated within [min_ms, max_ms].
 * Resolves the shared context + preloads once; each call is then pure CPU (no reads).
 */
async function create_in_memory_assigner(ctx, user_id, min_ms, max_ms) {
    const [shared, candidates, overlapping] = await Promise.all([
        (0, assignment_context_resolver_1.resolve_shared_assignment_context)(ctx, user_id),
        (0, recurring_matches_resolver_1.load_recurring_candidates)(ctx, user_id, min_ms - MATCH_MARGIN_MS, max_ms + MATCH_MARGIN_MS),
        source_period_repo_1.source_period_repo.get_overlapping(ctx, firestore_1.Timestamp.fromMillis(min_ms), firestore_1.Timestamp.fromMillis(max_ms)),
    ]);
    const source_periods = overlapping.map((p) => ({
        id: p.id,
        type: p.period_type,
        start_ms: p.start_date.toMillis(),
        end_ms: p.end_date.toMillis(),
    }));
    return async (doc_id, data) => {
        // An inactive (Plaid-removed) doc keeps whatever it had — the engine skips them too.
        if (data.isActive === false)
            return data;
        const resolved = await (0, assignment_context_resolver_1.resolve_assignment_context)(ctx, user_id, doc_id, shared, candidates, { id: doc_id, data }, source_periods);
        if (!resolved)
            return data;
        const result = (0, compute_transaction_assignment_service_1.compute_transaction_assignment)(resolved.splits_input, resolved.context);
        const merged = (0, merge_assignment_1.merge_assignment_onto_raw_splits)(resolved, result, firestore_1.Timestamp.now());
        /* eslint-disable @typescript-eslint/naming-convention */
        return Object.assign(Object.assign({}, data), { splits: merged.updated_splits, splitBudgetIds: merged.split_budget_ids, splitOutflowIds: merged.split_outflow_ids, splitInflowIds: merged.split_inflow_ids });
        /* eslint-enable @typescript-eslint/naming-convention */
    };
}
//# sourceMappingURL=assign_in_memory.js.map