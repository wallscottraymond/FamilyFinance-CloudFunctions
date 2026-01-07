/**
 * DEV FUNCTION: Create Test Budget
 *
 * Creates a test budget with configurable parameters for frontend testing.
 * This function allows developers to quickly create budgets and verify:
 * 1. Budget periods are generated correctly
 * 2. User_summaries are updated with budget data
 * 3. Spending calculations work properly
 *
 * IMPORTANT: This function should only be used in development/staging environments.
 *
 * @param request.data.amount - Budget amount (default: 500)
 * @param request.data.name - Budget name (default: "Test Budget")
 * @param request.data.period - Budget period (default: "MONTHLY")
 * @param request.data.categoryIds - Category IDs (default: [])
 * @param request.data.startDate - Start date (default: current month start)
 * @param request.data.endDate - End date (default: 1 year from start)
 * @param request.data.isSystemEverythingElse - Create as "Everything Else" budget (default: false)
 * @param request.data.currency - Currency code (default: "USD")
 *
 * @returns {object} Created budget details and summary of generated periods
 */
export declare const createTestBudget: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    budget: {
        id: string;
        name: any;
        amount: any;
        currency: any;
        period: any;
        isSystemEverythingElse: any;
        startDate: string;
        endDate: string;
        categoryIds: any;
        groupIds: string[];
    };
    periods: {
        count: number;
        breakdown: {
            MONTHLY: number;
            BI_MONTHLY: number;
            WEEKLY: number;
        };
        samples: {
            id: string;
            periodId: any;
            periodType: any;
            periodStart: any;
            periodEnd: any;
            allocatedAmount: any;
            spent: any;
            remaining: any;
        }[];
    };
    userSummaries: {
        count: number;
        summariesWithBudget: number;
        samples: {
            summaryId: string;
            periodType: any;
            sourcePeriodId: any;
            hasBudgetEntry: boolean;
            budgetEntry: any;
        }[];
    };
    testingInstructions: {
        step1: string;
        step2: string;
        step3: string;
        step4: string;
        step5: string;
    };
}>>;
//# sourceMappingURL=createTestBudget.d.ts.map