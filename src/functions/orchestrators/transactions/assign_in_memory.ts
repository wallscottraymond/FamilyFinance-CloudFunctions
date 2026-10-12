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

import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import {
  resolve_assignment_context,
  resolve_shared_assignment_context,
} from "../../resolvers/transactions/assignment_context.resolver";
import { load_recurring_candidates } from "../../resolvers/transactions/recurring_matches.resolver";
import { compute_transaction_assignment } from "../../domain/transactions/compute_transaction_assignment.service";
import { merge_assignment_onto_raw_splits } from "./merge_assignment";
import { source_period_repo } from "../../repositories/source_period.repo";
import { SourcePeriodForMatch } from "../../domain/transactions/match_source_periods.service";

/** Matcher half-window: a txn can match a due period within ±90d of its date. */
const MATCH_MARGIN_MS = 90 * 24 * 60 * 60 * 1000;

export type InMemoryAssigner = (
  doc_id: string,
  data: Record<string, unknown>
) => Promise<Record<string, unknown>>;

/**
 * Build an assigner for one user's batch of transactions dated within [min_ms, max_ms].
 * Resolves the shared context + preloads once; each call is then pure CPU (no reads).
 */
export async function create_in_memory_assigner(
  ctx: TraceContext,
  user_id: string,
  min_ms: number,
  max_ms: number
): Promise<InMemoryAssigner> {
  const [shared, candidates, overlapping] = await Promise.all([
    resolve_shared_assignment_context(ctx, user_id),
    load_recurring_candidates(ctx, user_id, min_ms - MATCH_MARGIN_MS, max_ms + MATCH_MARGIN_MS),
    source_period_repo.get_overlapping(ctx, Timestamp.fromMillis(min_ms), Timestamp.fromMillis(max_ms)),
  ]);
  const source_periods: SourcePeriodForMatch[] = overlapping.map((p) => ({
    id: p.id,
    type: p.period_type,
    start_ms: p.start_date.toMillis(),
    end_ms: p.end_date.toMillis(),
  }));

  return async (doc_id, data) => {
    // An inactive (Plaid-removed) doc keeps whatever it had — the engine skips them too.
    if (data.isActive === false) return data;
    const resolved = await resolve_assignment_context(
      ctx,
      user_id,
      doc_id,
      shared,
      candidates,
      { id: doc_id, data },
      source_periods
    );
    if (!resolved) return data;
    const result = compute_transaction_assignment(resolved.splits_input, resolved.context);
    const merged = merge_assignment_onto_raw_splits(resolved, result, Timestamp.now());
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
      ...data,
      splits: merged.updated_splits,
      splitBudgetIds: merged.split_budget_ids,
      splitOutflowIds: merged.split_outflow_ids,
      splitInflowIds: merged.split_inflow_ids,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  };
}
