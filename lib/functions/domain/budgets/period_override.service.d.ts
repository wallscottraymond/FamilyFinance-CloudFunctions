/**
 * "This Period Only" — which amount a budget period really has (Transaction-Integrity X10).
 *
 * NEW edits are stored as `periodAdjustments` on the budget's MONTHLY docs
 * (domain/budgets/period_allocation_view) and counted by `period_allocation` below. LEGACY data:
 * `updateBudgetPeriodAmount` used to store the user's amount as `modifiedAmount` (+ `isModified`)
 * on the budget's OWN (prime) period. `syncModifiedAmountToOverlappingPeriods` then pastes the same
 * figure, unprorated, onto overlapping periods of the other types and marks them
 * `modifiedAmountSyncedFrom` / `modifiedAmountSyncedAt`. Those copies are bookkeeping, never the
 * period's amount (a week's $150 would otherwise become a whole month's allocation).
 *
 * THE rule, used by every reader (period page, budget view, recompute, rollover): a period's
 * override is its `modifiedAmount` only when it was set DIRECTLY on the budget's own period —
 * not a synced copy. A copy marker older than a later direct edit (`lastModifiedAt`) doesn't
 * count (older code never cleared the marker on a direct edit). PURE.
 */
export interface PeriodAmountFields {
    allocatedAmount?: number | null;
    modifiedAmount?: number | null;
    isModified?: boolean | null;
    isPrime?: boolean | null;
    modifiedAmountSyncedFrom?: string | null;
    modifiedAmountSyncedAt?: unknown;
    lastModifiedAt?: unknown;
    /** "This Period Only" adjustments on a MONTHLY doc (domain/budgets/period_allocation_view). */
    periodAdjustments?: Array<{
        amount?: number | null;
    }> | null;
}
/** The user's direct "This Period Only" amount on this period, else null. */
export declare function direct_period_override(p: PeriodAmountFields): number | null;
/** Σ of the "This Period Only" adjustment amounts stored on this (monthly) period. */
export declare function period_adjustments_total(p: PeriodAmountFields): number;
/**
 * The amount this period has to spend before rollover: the (legacy) override, else its
 * allocation — plus the "This Period Only" adjustments stored on it (only monthly docs carry
 * them; for the whole month the page shows exactly this sum).
 */
export declare function period_allocation(p: PeriodAmountFields): number;
//# sourceMappingURL=period_override.service.d.ts.map