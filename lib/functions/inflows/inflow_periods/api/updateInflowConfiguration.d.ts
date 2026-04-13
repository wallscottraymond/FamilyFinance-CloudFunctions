/**
 * Update Inflow Configuration Callable
 *
 * Updates the income type configuration for an inflow and recalculates
 * all existing InflowPeriods in place (preserving user notes and other data).
 *
 * Key behaviors:
 * - Updates income type and type-specific configuration
 * - Recalculates expectedAmount and predictionConfidence for all periods
 * - Preserves existing period data (notes, transaction matches)
 * - Sets isUserClassified: true to indicate user has configured the income
 */
interface UpdateInflowConfigResponse {
    success: boolean;
    inflowId: string;
    periodsUpdated: number;
    newPrediction: {
        expectedAmount: number;
        confidence: 'high' | 'medium' | 'low';
    };
}
export declare const updateInflowConfiguration: import("firebase-functions/v2/https").CallableFunction<any, Promise<UpdateInflowConfigResponse>>;
export {};
//# sourceMappingURL=updateInflowConfiguration.d.ts.map