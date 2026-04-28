/**
 * Create Manual Inflow Callable
 *
 * Creates a new manually-entered recurring income stream.
 * For income not detected by Plaid (freelance work, side jobs, etc.)
 *
 * This function:
 * 1. Creates the inflow document
 * 2. Triggers period generation via onInflowCreated trigger
 */
interface CreateManualInflowResponse {
    success: boolean;
    inflowId: string;
    message: string;
}
export declare const createManualInflow: import("firebase-functions/v2/https").CallableFunction<any, Promise<CreateManualInflowResponse>, unknown>;
export {};
//# sourceMappingURL=createManualInflow.d.ts.map