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
import { TraceContext } from "../../types";
export type InMemoryAssigner = (doc_id: string, data: Record<string, unknown>) => Promise<Record<string, unknown>>;
/**
 * Build an assigner for one user's batch of transactions dated within [min_ms, max_ms].
 * Resolves the shared context + preloads once; each call is then pure CPU (no reads).
 */
export declare function create_in_memory_assigner(ctx: TraceContext, user_id: string, min_ms: number, max_ms: number): Promise<InMemoryAssigner>;
//# sourceMappingURL=assign_in_memory.d.ts.map