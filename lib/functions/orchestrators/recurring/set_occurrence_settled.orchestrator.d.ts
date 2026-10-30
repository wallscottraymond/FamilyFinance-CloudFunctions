/**
 * Set Occurrence Settled Orchestrator ("Mark as paid" / "Mark as received")
 *
 * Marks ONE occurrence of a bill / income settled by hand — a payment made in cash / Venmo / from
 * an account that isn't linked, so no transaction will ever arrive — or clears the mark. The mark
 * is durable user state on the DEFINITION (`manualSettledOccurrences[<due date>]`); the period
 * page and the stored reconcile both apply it on read through one rule
 * (domain/recurring/manual_settlement — a real payment always wins).
 *
 * Flow: resolve (item + expected-amount inputs) → authorize (owner or group member) → validate
 * the due date is an occurrence of the item → transactional write (repo) → bump the derive
 * version AFTER the write (derive caches live 24h) → enqueue the item's stored reconcile.
 *
 * @module orchestrators/recurring/set_occurrence_settled
 */
import { TraceContext } from "../../types";
import { SettlementKind } from "../../resolvers/recurring/occurrence_settlement.resolver";
export interface SetOccurrenceSettledInput {
    kind: SettlementKind;
    recurring_id: string;
    /** The occurrence's UTC due date, `YYYY-MM-DD`. */
    due_date: string;
    /** true = mark settled; false = remove the mark. */
    settled: boolean;
    /** The settled amount; defaults to the occurrence's EXPECTED amount (as the page shows it). */
    amount?: number;
}
export interface SetOccurrenceSettledResult {
    kind: SettlementKind;
    recurring_id: string;
    due_date: string;
    settled: boolean;
    /** The marked amount (null when unmarked). */
    amount: number | null;
}
export declare function set_occurrence_settled_orchestrator(ctx: TraceContext, user_id: string, user_group_ids: string[], input: SetOccurrenceSettledInput): Promise<SetOccurrenceSettledResult>;
//# sourceMappingURL=set_occurrence_settled.orchestrator.d.ts.map