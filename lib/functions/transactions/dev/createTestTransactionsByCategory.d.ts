/**
 * Create Test Transactions By Category - Development Function
 *
 * Generates 5 transactions for each category in the categories collection.
 * Transaction names follow pattern: "{category_name} {number}"
 * Income categories = credits (positive), Outflow categories = debits (negative)
 * Dates spread equally between November 2025 and March 2026 (5 months)
 */
/**
 * Firebase Callable Function to create test transactions for all categories
 */
export declare const createTestTransactionsByCategory: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    message: string;
    data: {
        targetUserId: string;
        testItemId: string;
        testAccountId: string;
        categoriesProcessed: number;
        transactionsCreated: number;
        dateRange: {
            start: string;
            end: string;
        };
        incomeTransactions: number;
        outflowTransactions: number;
    };
    hint: string;
}>>;
//# sourceMappingURL=createTestTransactionsByCategory.d.ts.map