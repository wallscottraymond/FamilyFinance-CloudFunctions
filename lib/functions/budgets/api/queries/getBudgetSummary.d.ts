/**
 * Get budget spending summary.
 *
 * Callable (onCall): use the Firebase Functions SDK (httpsCallable). Returns the
 * summary object directly. Pass `{ id: budgetId }` in the callable payload.
 */
export declare const getBudgetSummary: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    budget: {
        id: string | undefined;
        name: string;
        amount: number;
        currency: string;
        period: import("../../../../types").BudgetPeriod;
        categoryIds: string[];
    };
    spending: {
        total: number;
        remaining: number;
        percentage: number;
        isOverBudget: boolean;
        alertThresholdReached: boolean;
    };
    transactions: {
        count: number;
        recent: import("../../../../types").BaseDocument[];
    };
    members: {
        user: {
            id: string;
            displayName: any;
            email: any;
        };
        spending: {
            amount: number;
            transactionCount: number;
        };
        percentage: number;
    }[];
}>, unknown>;
//# sourceMappingURL=getBudgetSummary.d.ts.map