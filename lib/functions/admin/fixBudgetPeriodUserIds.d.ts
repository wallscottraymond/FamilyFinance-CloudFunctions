/**
 * ADMIN: Fix Budget Period UserIds
 *
 * This function fixes budget_periods that are missing the userId field
 * by reading the parent budget's access.createdBy field and populating it.
 *
 * Usage:
 * firebase functions:call fixBudgetPeriodUserIds
 */
export declare const fixBudgetPeriodUserIds: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    fixed: number;
    errors?: undefined;
    total?: undefined;
} | {
    success: boolean;
    message: string;
    fixed: number;
    errors: number;
    total: number;
}>>;
//# sourceMappingURL=fixBudgetPeriodUserIds.d.ts.map