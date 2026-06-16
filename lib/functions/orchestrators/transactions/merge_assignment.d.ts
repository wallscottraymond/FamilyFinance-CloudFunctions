/**
 * Merge Assignment onto Raw Splits
 *
 * Pure helper shared by the single-item (`assign_transaction`) and batch
 * (`assign_transactions_batch`) orchestrators: merges the engine's computed
 * assignment back onto the raw camelCase split maps (so the write preserves
 * fields the engine doesn't own) and denormalizes the matched budget's name.
 *
 * Kept in ONE place so the skip-if-unchanged / name-heal semantics can't drift
 * between the two call sites.
 *
 * @module orchestrators/transactions/merge_assignment
 */
import { Timestamp } from "firebase-admin/firestore";
import { ResolvedAssignment } from "../../resolvers/transactions/assignment_context.resolver";
import { TransactionAssignmentResult } from "../../domain/transactions/compute_transaction_assignment.service";
/** The merged splits plus the signals the orchestrators branch on. */
export interface MergedAssignment {
    /** Raw split maps with the engine-owned fields + budgetName merged in. */
    updated_splits: Array<Record<string, unknown>>;
    /**
     * True when only `budgetName` drifted (assignment unchanged). The caller still
     * writes (display heal) but does NOT fan out a recompute (spend unmoved).
     */
    name_changed: boolean;
    /** Distinct budget ids across the splits (the denormalized `splitBudgetIds`). */
    split_budget_ids: string[];
}
/**
 * Merge `result` onto `resolved.raw_splits`. PURE — `now` is injected so the
 * caller controls the timestamp (and tests stay deterministic).
 */
export declare function merge_assignment_onto_raw_splits(resolved: ResolvedAssignment, result: TransactionAssignmentResult, now: Timestamp): MergedAssignment;
//# sourceMappingURL=merge_assignment.d.ts.map