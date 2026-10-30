/**
 * Manual Settlement Domain Service ("Mark as paid" / "Mark as received")
 *
 * A bill paid in cash / Venmo / from an account that isn't linked — or income received outside
 * the linked accounts — never gets a transaction, so the user marks that OCCURRENCE settled by
 * hand. The mark lives on the recurring DEFINITION (`manualSettledOccurrences`, keyed by the
 * occurrence's UTC due date `YYYY-MM-DD`) and is applied on read by ONE rule, used by BOTH the
 * period page (derive) and the stored period reconcile, so paid counts / totals / status agree:
 *
 *   - an occurrence a REAL payment settles is settled by that payment — the mark is ignored
 *     (never double-counted);
 *   - an occurrence with no real payment but a mark is settled MANUALLY: amount = the mark's
 *     amount, payment date = its due date, flagged manual.
 *
 * PURE: no IO, time as ms.
 *
 * @module domain/recurring/manual_settlement
 */
import type { ReconciledOccurrence } from "./reconcile_occurrences.service";
/** One manual mark on an occurrence. */
export interface ManualSettlementMark {
    /** The amount the occurrence counts as paid / received. */
    amount: number;
    /** When it was marked (epoch ms); null when unknown. */
    marked_at_ms: number | null;
    /** Who marked it (uid); null when unknown. */
    marked_by: string | null;
}
/** Marks keyed by the occurrence's UTC due date `YYYY-MM-DD`. */
export type ManualSettledOccurrences = Record<string, ManualSettlementMark>;
/** THE key of an occurrence: its UTC due date `YYYY-MM-DD` (same key as occurrence overrides). */
export declare function occurrence_date_key(due_date_ms: number): string;
/** UTC midnight (ms) of a `YYYY-MM-DD` key, or null when it isn't a real calendar date. */
export declare function parse_occurrence_date_key(key: string): number | null;
/**
 * THE rule for one occurrence: the amount it counts as settled MANUALLY, or null when it isn't
 * (a real payment settles it, or there's no mark for its due date).
 */
export declare function manual_settlement_amount(due_date_ms: number, settled_by_real_payment: boolean, marks: ManualSettledOccurrences | undefined): number | null;
/**
 * Apply the rule to reconciled occurrences (the period page): an occurrence no real payment
 * matched but the user marked becomes paid, by the mark's amount on its due date, flagged
 * `is_manual`. Matched occurrences (and income's extra deposits) pass through unchanged.
 */
export declare function apply_manual_settlements(reconciled: ReconciledOccurrence[], marks: ManualSettledOccurrences | undefined): ReconciledOccurrence[];
//# sourceMappingURL=manual_settlement.service.d.ts.map