/**
 * Regenerate Inflow Periods Callable
 *
 * Admin/dev function to regenerate inflow_periods for an existing inflow.
 * Useful for fixing data when periods weren't created correctly.
 *
 * Usage:
 * - Call with inflowId to regenerate periods for that specific inflow
 * - Call without inflowId to regenerate for all user's inflows
 */
interface RegenerateResult {
    inflowsProcessed: number;
    periodsCreated: number;
    periodsUpdated: number;
    errors: string[];
}
export declare const regenerateInflowPeriods: import("firebase-functions/v2/https").CallableFunction<any, Promise<RegenerateResult>>;
export {};
//# sourceMappingURL=regenerateInflowPeriods.d.ts.map