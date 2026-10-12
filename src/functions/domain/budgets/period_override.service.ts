/**
 * "This Period Only" — which amount a budget period really has (Transaction-Integrity X10).
 *
 * `updateBudgetPeriodAmount` stores the user's amount as `modifiedAmount` (+ `isModified`) on the
 * budget's OWN (prime) period. `syncModifiedAmountToOverlappingPeriods` then pastes the same
 * figure, unprorated, onto overlapping periods of the other types and marks them
 * `modifiedAmountSyncedFrom` / `modifiedAmountSyncedAt`. Those copies are bookkeeping, never the
 * period's amount (a week's $150 would otherwise become a whole month's allocation).
 *
 * THE rule, used by every reader (period page, budget view, recompute, rollover): a period's
 * override is its `modifiedAmount` only when it was set DIRECTLY on the budget's own period —
 * not a synced copy. A copy marker older than a later direct edit (`lastModifiedAt`) doesn't
 * count (older code never cleared the marker on a direct edit). PURE.
 */

/* eslint-disable @typescript-eslint/naming-convention */
export interface PeriodAmountFields {
  allocatedAmount?: number | null;
  modifiedAmount?: number | null;
  isModified?: boolean | null;
  isPrime?: boolean | null;
  modifiedAmountSyncedFrom?: string | null;
  modifiedAmountSyncedAt?: unknown;
  lastModifiedAt?: unknown;
}
/* eslint-enable @typescript-eslint/naming-convention */

function to_ms(v: unknown): number | null {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const t = v as { toMillis?: () => number } | null;
  if (t && typeof t.toMillis === "function") return t.toMillis();
  if (v instanceof Date) return v.getTime();
  return null;
}

/** The user's direct "This Period Only" amount on this period, else null. */
export function direct_period_override(p: PeriodAmountFields): number | null {
  if (p.isModified !== true || typeof p.modifiedAmount !== "number") return null;
  if (p.isPrime === false) return null;
  if (p.modifiedAmountSyncedFrom) {
    const synced = to_ms(p.modifiedAmountSyncedAt);
    const direct = to_ms(p.lastModifiedAt);
    // A synced copy — unless the user edited this period directly AFTER the copy landed.
    if (!(synced !== null && direct !== null && direct > synced)) return null;
  }
  return p.modifiedAmount;
}

/** The amount this period has to spend before rollover: the override, else its allocation. */
export function period_allocation(p: PeriodAmountFields): number {
  return direct_period_override(p) ?? p.allocatedAmount ?? 0;
}
