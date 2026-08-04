/**
 * Derive Recurring View Entry Point
 *
 * Cloud Function entry for the Derive-On-Read Period Architecture (Phase 3):
 * compute a bill/income (recurring outflow) view for a bounded visible window,
 * fresh from the item's schedule + actual payments. Read-only; writes nothing.
 *
 * The window is HARD-BOUNDED here (design guardrail): only the visible window.
 *
 * @module entry/callable/derive_recurring_view
 */
import { FunctionResponse } from "../../types";
/** A placed occurrence group as returned to the client (camelCase DTO). */
interface RecurringViewGroupResponse {
    periodId: string;
    occurrenceIds: string[];
    countInPeriod: number;
    countPaid: number;
    countUnpaid: number;
    totalDue: number;
    totalPaid: number;
    totalUnpaid: number;
    isDuePeriod: boolean;
    isFullyPaid: boolean;
    isPartiallyPaid: boolean;
    status: string;
}
interface DeriveRecurringViewResponseData {
    kind: string;
    recurringId: string;
    name: string;
    viewCadence: string;
    groups: RecurringViewGroupResponse[];
}
export declare const derive_recurring_view: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<DeriveRecurringViewResponseData>>, unknown>;
export {};
//# sourceMappingURL=derive_recurring_view.entry.d.ts.map