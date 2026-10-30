/**
 * Occurrence Settlement Resolver ("Mark as paid / received")
 *
 * READ-ONLY. Loads what `set_occurrence_settled` needs about a bill / income: its owner + groups
 * (auth), its existing marks, and its expected-amount inputs shaped EXACTLY as the period page
 * reads them (definition override over Plaid's average; income: per-occurrence overrides and,
 * when asked, the stream's deposit history for the per-slot estimate).
 *
 * @module resolvers/recurring/occurrence_settlement
 */
import { TraceContext } from "../../types";
import { RecurringForExpected } from "../../domain/recurring/expected_occurrences.service";
import { ManualSettledOccurrences } from "../../domain/recurring/manual_settlement.service";
export type SettlementKind = "outflow" | "inflow";
export interface OccurrenceSettlementContext {
    owner_id: string;
    group_ids: string[];
    marks: ManualSettledOccurrences;
    /** The item's expected-amount inputs (the period page's shape). */
    item: RecurringForExpected;
}
/**
 * Resolve the item, or null when it doesn't exist / is inactive.
 *
 * @param with_history - INCOME: also load the stream's deposits for the per-slot estimate
 *                       (only needed to default a mark's amount to the expected one).
 */
export declare function resolve_occurrence_settlement_context(ctx: TraceContext, kind: SettlementKind, recurring_id: string, with_history: boolean): Promise<OccurrenceSettlementContext | null>;
//# sourceMappingURL=occurrence_settlement.resolver.d.ts.map