/**
 * Undo Recurring Merge Orchestrator (Convert-To-Recurring D18 / D22 / D41, review items 8-9, 13).
 *
 * Two undos, both owner-only and flag-gated:
 *   - `merge`: a same-bill merge (or a convert over an old bill) — the old bill gets its intervals
 *     back, loses mergedIntoId / mergeLog, the new bill's inherited name / override are reset where
 *     the user hasn't changed them since, the "same bill?" question becomes `keep_separate`, and the
 *     account re-assigns once. The merge target may be gone (deleted): the old bill is still restored.
 *   - `absorb`: a Plaid stream a converted bill absorbed is marked `declined`; the next sync creates
 *     a separate bill for it.
 * Ownership is checked on the old bill AND on the merge target.
 *
 * @module orchestrators/recurring/undo_recurring_merge
 */
import { TraceContext } from "../../types";
export type UndoInput = {
    kind: "outflow" | "inflow";
    mode: "merge";
    record_id: string;
} | {
    kind: "outflow" | "inflow";
    mode: "absorb";
    record_id: string;
    stream_id: string;
};
export declare function undo_recurring_merge_orchestrator(ctx: TraceContext, user_id: string, input: UndoInput, now_ms: number): Promise<{
    record_id: string;
    mode: string;
    no_op: boolean;
}>;
//# sourceMappingURL=undo_recurring_merge.orchestrator.d.ts.map