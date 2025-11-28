/**
 * Admin Function: Create Test User Period Summaries
 *
 * This function allows testing the period summary pre-creation logic
 * without having to create a new user each time. It follows the exact
 * same flow as the onUserCreate trigger.
 *
 * Usage from mobile app:
 * - Button in Dev Tools screen
 * - Automatically uses current user's ID
 *
 * Usage from curl (optional):
 * curl -X POST http://127.0.0.1:5001/family-budget-app-cb59b/us-central1/createTestUserPeriodSummaries \
 *   -H "Content-Type: application/json" \
 *   -d '{"userId": "YOUR_USER_ID"}'
 */
export declare const createTestUserPeriodSummaries: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    userId: string;
    userEmail: any;
    duration: string;
    summaries: {
        before: number;
        after: number;
        created: number;
    };
    message: string;
}>>;
//# sourceMappingURL=createTestUserPeriodSummaries.d.ts.map