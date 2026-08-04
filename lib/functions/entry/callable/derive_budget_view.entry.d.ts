/**
 * Derive Budget View Entry Point
 *
 * Cloud Function entry for the Derive-On-Read Period Architecture (Phase 1):
 * compute a budget's weekly / bi-weekly VIEW for a bounded visible window from
 * the single materialized monthly home. Read-only; deletes/writes nothing.
 *
 * The window is HARD-BOUNDED here (the design's guardrail): a request may not
 * derive an unbounded range — only the visible window (± a little look-ahead).
 *
 * @module entry/callable/derive_budget_view
 */
import { FunctionResponse } from "../../types";
/** A derived view period as returned to the client (camelCase DTO). */
interface DerivedViewPeriodResponse {
    budgetId: string;
    periodId: string;
    periodType: string;
    periodStart: number;
    periodEnd: number;
    allocatedAmount: number;
    effectiveAmount: number;
    spent: number;
    pendingSpent: number;
    returnAmount: number;
    remaining: number;
    isDerived: true;
}
interface DeriveBudgetViewResponseData {
    budgetId: string;
    budgetName: string;
    viewCadence: string;
    periods: DerivedViewPeriodResponse[];
}
/**
 * Derive a budget's non-monthly view for a bounded window.
 *
 * @returns The derived view periods, or throws not-found if the budget isn't
 *          owned by the caller.
 */
export declare const derive_budget_view: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<DeriveBudgetViewResponseData>>, unknown>;
export {};
//# sourceMappingURL=derive_budget_view.entry.d.ts.map