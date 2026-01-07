/**
 * Admin function to create "everything else" budgets for existing users
 *
 * This migration function backfills "everything else" budgets for users
 * who were created before the feature was implemented.
 *
 * Usage: firebase functions:call createMissingEverythingElseBudgets
 */
import { Timestamp } from 'firebase-admin/firestore';
/**
 * Summary of migration results
 */
interface MigrationSummary {
    totalUsers: number;
    budgetsCreated: number;
    budgetsSkipped: number;
    errors: number;
    timestamp: Timestamp;
}
/**
 * Error details for failed user migrations
 */
interface MigrationError {
    userId: string;
    error: string;
}
/**
 * Response from the migration function
 */
interface MigrationResponse {
    success: boolean;
    summary?: MigrationSummary;
    errorDetails?: MigrationError[];
    error?: {
        code: string;
        message: string;
    };
}
/**
 * Create "everything else" budgets for existing users
 *
 * Admin-only callable function that:
 * 1. Queries all active users
 * 2. Checks if each user already has an "everything else" budget
 * 3. Creates the budget if missing
 * 4. Returns summary statistics
 *
 * @param request - Callable function request
 * @returns Migration summary with created/skipped/error counts
 */
export declare const createMissingEverythingElseBudgets: import("firebase-functions/v2/https").CallableFunction<any, Promise<MigrationResponse>>;
export {};
//# sourceMappingURL=createMissingEverythingElseBudgets.d.ts.map