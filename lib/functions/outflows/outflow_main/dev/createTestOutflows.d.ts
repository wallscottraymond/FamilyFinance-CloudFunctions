/**
 * Create Test Outflows - Admin Function
 *
 * Simulates a Plaid recurring transactions response and runs the complete
 * sync pipeline (format → enhance → batch create) to test the production flow.
 *
 * This function:
 * 1. Creates a test plaid_item (if needed)
 * 2. Simulates Plaid /transactions/recurring/get response
 * 3. Runs the complete inflow/outflow pipeline as it would in production
 * 4. Triggers onOutflowCreated which generates outflow_periods
 *
 * Memory: 512MiB, Timeout: 120s
 */
export declare const createTestOutflows: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    data: {
        targetUserId: string;
        testPlaidItemId: string;
        testFamilyId: string;
        inflowsCreated: number;
        inflowsUpdated: number;
        outflowsCreated: number;
        outflowsUpdated: number;
        outflowPeriodsCreated: number;
        errors: string[];
        simulatedResponse: {
            inflowStreams: number;
            outflowStreams: number;
        };
    };
}>>;
//# sourceMappingURL=createTestOutflows.d.ts.map