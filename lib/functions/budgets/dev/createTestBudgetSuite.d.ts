/**
 * DEV FUNCTION: Create Test Budget Suite
 *
 * Creates a complete test suite with THREE budgets (weekly, bi-weekly, monthly)
 * and sample transactions to verify the full budget period summary flow.
 *
 * This function tests:
 * 1. Budget creation with different period types
 * 2. Budget period generation for all three types
 * 3. Transaction creation and budget spending updates
 * 4. User_summaries calculation with new fixes (totalSpent, userNotes, maxAmount)
 *
 * IMPORTANT: This function should only be used in development/staging environments.
 *
 * @param request.data.groupId - Optional group ID for shared budgets
 * @param request.data.createTransactions - Whether to create test transactions (default: true)
 * @param request.data.transactionAmount - Amount for test transactions (default: 75)
 *
 * @returns {object} Comprehensive test results for all three budgets
 */
export declare const createTestBudgetSuite: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    summary: {
        budgetsCreated: number;
        transactionsCreated: number;
        totalPeriodsGenerated: any;
    };
    budgets: any[];
    userSummaries: {
        count: number;
        summaries: {
            summaryId: string;
            periodType: any;
            sourcePeriodId: any;
            matchingBudgets: {
                period: any;
                budgetId: any;
                found: boolean;
                entry: {
                    budgetName: any;
                    maxAmount: any;
                    totalAllocated: any;
                    totalSpent: any;
                    totalRemaining: any;
                    progressPercentage: any;
                    userNotes: any;
                } | null;
            }[];
        }[];
    };
    verification: {
        step1: string;
        step2: string;
        step3: string;
        step4: string;
        step5: string;
        step6: string;
    };
    testingInstructions: {
        nextSteps: string[];
    };
}>>;
//# sourceMappingURL=createTestBudgetSuite.d.ts.map