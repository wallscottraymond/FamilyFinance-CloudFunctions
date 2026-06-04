/**
 * Assignment Field Guard Domain Service
 *
 * Pure decision: did a transaction write change anything the assignment engine
 * cares about? The thin trigger uses this to enqueue an `assign_transaction` job
 * ONLY on assignment- or spend-relevant changes — cosmetic edits (notes, tags,
 * description) run nothing at all.
 *
 * Relevant fields: the transaction date, amount, active flag, the
 * category-feeding fields (merchant/name), and — per split — amount, budget id,
 * category, manual-pin source, ignored flag, and the recurring links; plus any
 * split add/remove. Creates and deletes are always relevant.
 *
 * NO async, NO IO, NO side effects.
 *
 * @module domain/transactions/assignment_field_guard
 */
type Doc = Record<string, unknown> | null | undefined;
/**
 * Whether an assignment-relevant field changed between two transaction states.
 * `before == null` → create; `after == null` → hard delete. Both are relevant.
 *
 * PURE FUNCTION.
 */
export declare function is_assignment_relevant_change(before: Doc, after: Doc): boolean;
/**
 * Whether a SPEND-affecting field changed on an UPDATE (e.g. a split amount or
 * `isIgnored` toggle) — these don't change the budget assignment, so the assign
 * orchestrator skips its recompute fan-out, but the budget's spend MUST be
 * recomputed. Create/delete return false (handled elsewhere).
 *
 * PURE FUNCTION.
 */
export declare function is_spend_relevant_change(before: Doc, after: Doc): boolean;
export {};
//# sourceMappingURL=assignment_field_guard.service.d.ts.map