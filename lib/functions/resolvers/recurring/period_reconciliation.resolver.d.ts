/**
 * Period Reconciliation Resolver (Recurring-Period-Reconciliation Phase 3c)
 *
 * READ-ONLY. Loads everything the pure domain needs to reconcile a recurring
 * doc's periods: the recurring doc (for its `transactionIds` inbound list + the
 * variable-amount flag), its ACTIVE periods, and the linked splits.
 *
 * ⚠️ Honors the domain CONTRACT: `amount` is sign-normalized so positive =
 * toward paid/received (refunds negative). Ignored splits are excluded.
 *
 * @module resolvers/recurring/period_reconciliation
 */
import { TraceContext } from "../../types";
import { RemovalInterval } from "../../domain/recurring/recurring_suppression.service";
import { ManualSettledOccurrences } from "../../domain/recurring/manual_settlement.service";
export type RecurringType = "outflow" | "inflow";
/** Period data the domain needs (alignment + reconciliation). */
export interface ResolvedReconciliationPeriod {
    period_id: string;
    start_ms: number;
    end_ms: number;
    due_date_ms: number | null;
    /** Expected amount of a SINGLE occurrence (domain recomputes the period total). */
    amount_per_occurrence: number;
    /** Expected occurrence due dates (epoch ms); domain self-corrects to [start,end]. */
    occurrence_due_dates_ms: number[];
    is_variable_amount: boolean;
    /** "monthly" | "weekly" | "bi_monthly" — periods of all types overlap in time. */
    period_type: string;
    /** Fingerprint of the stored reconciliation (null = never reconciled) — unchanged → no write. */
    stored_fingerprint: string | null;
    /** D28: active only because it holds an early payment carried from a removed month. */
    carry_active?: boolean;
}
/** A linked split, sign-normalized, with its date for alignment. */
export interface ResolvedLinkedSplit {
    transaction_id: string;
    split_id: string;
    amount: number;
    is_pending: boolean;
    date_ms: number;
}
export interface ResolvedReconciliation {
    periods: ResolvedReconciliationPeriod[];
    splits: ResolvedLinkedSplit[];
    /** "Mark as paid / received" marks on the definition (applied by the shared rule). */
    manual_marks: ManualSettledOccurrences;
    /** D28: the item's INACTIVE periods (an early payment may carry into one) — only loaded data,
     *  no extra read; empty when the item has no removal intervals. */
    inactive_periods?: ResolvedReconciliationPeriod[];
    removal_intervals?: RemovalInterval[];
}
export interface ResolveReconciliationInput {
    recurring_id: string;
    recurring_type: RecurringType;
}
export declare function resolve_recurring_reconciliation(ctx: TraceContext, input: ResolveReconciliationInput): Promise<ResolvedReconciliation>;
//# sourceMappingURL=period_reconciliation.resolver.d.ts.map