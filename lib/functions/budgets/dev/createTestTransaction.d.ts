/**
 * DEV FUNCTION: Create Test Transaction
 *
 * Creates a test transaction linked to a budget for testing spending calculations.
 * This allows developers to verify:
 * 1. Transaction creation works
 * 2. Budget spending is updated (via updateBudgetSpending trigger)
 * 3. User_summaries.budgets[].totalSpent reflects the change
 *
 * IMPORTANT: This function should only be used in development/staging environments.
 *
 * @param request.data.budgetId - Budget ID to link transaction to
 * @param request.data.amount - Transaction amount (default: 50)
 * @param request.data.description - Transaction description (default: "Test Transaction")
 * @param request.data.date - Transaction date (default: now)
 * @param request.data.categoryId - Category ID (optional)
 *
 * @returns {object} Created transaction details and updated budget period info
 */
export declare const createTestTransaction: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    transaction: {
        id: string;
        amount: any;
        description: any;
        date: string;
        budgetId: any;
        budgetPeriodId: string | null;
        categoryId: any;
    };
    budgetPeriod: {
        matched: boolean;
        before: {
            id: string;
            periodId: any;
            periodType: any;
            allocatedAmount: any;
            spentBefore: any;
        } | null;
        after: {
            id: string;
            periodId: any;
            periodType: any;
            allocatedAmount: any;
            spentAfter: any;
            remaining: any;
            spentIncrease: number;
        } | null;
    };
    userSummaries: {
        count: number;
        samples: {
            summaryId: string;
            periodType: any;
            sourcePeriodId: any;
            budgetEntry: {
                budgetName: any;
                totalAllocated: any;
                totalSpent: any;
                totalRemaining: any;
                progressPercentage: any;
            } | null;
        }[];
    };
    verification: {
        step1: string;
        step2: string;
        step3: string;
        step4: string;
    };
}>>;
//# sourceMappingURL=createTestTransaction.d.ts.map