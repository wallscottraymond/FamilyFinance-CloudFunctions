/**
 * Admin utility to re-process existing Plaid transactions
 *
 * This function will re-run the category mapping and budget period matching
 * for existing transactions to apply fixes.
 *
 * USE WITH CAUTION - This will modify existing transaction data
 */
export declare const reprocessPlaidTransactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    totalProcessed: number;
    updatedCount: number;
    skippedCount: number;
    dryRun: boolean;
    changes: {
        transactionId: string;
        changes: any;
    }[];
    message: string;
}>>;
//# sourceMappingURL=migrateTransactionSplits.d.ts.map