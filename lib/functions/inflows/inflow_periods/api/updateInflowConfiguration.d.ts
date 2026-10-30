/**
 * Update Inflow Configuration Callable
 *
 * Two kinds of call:
 * - The "Regular Salary" toggle: `isRegularSalary` present → saves ONLY that flag. (The app sent
 *   its screen's default type alongside it; the type and configs are left alone — Code-Health-
 *   Review M7-H1.)
 * - A type / config edit: saves the type, its variability and the config blocks SENT (blocks not
 *   sent are kept — M2-M2). When the config implies an amount (hourly rate × hours, base +
 *   commission, …) that differs from the current expected amount, it becomes the income's
 *   expected amount (`expectedAmountOverride`), which the period page, the stored periods
 *   (runUpdateInflowPeriods via on_inflow_updated) and the extenders all follow. Period AMOUNTS
 *   are never written here; only the denormalized `incomeType` / `predictionConfidence`.
 * - Sets isUserClassified: true to indicate user has configured the income
 */
interface UpdateInflowConfigResponse {
    success: boolean;
    inflowId: string;
    periodsUpdated: number;
    newPrediction: {
        expectedAmount: number;
        confidence: "high" | "medium" | "low";
    };
}
export declare const updateInflowConfiguration: import("firebase-functions/v2/https").CallableFunction<any, Promise<UpdateInflowConfigResponse>, unknown>;
export {};
//# sourceMappingURL=updateInflowConfiguration.d.ts.map