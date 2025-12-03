/**
 * Simulate Plaid Recurring Transactions - Dev Testing Function
 *
 * This function simulates receiving recurring transaction data from Plaid
 * and processes it through the standard pipeline (format → enhance → batch create).
 *
 * Use this to test the complete Plaid → Firestore pipeline without needing
 * actual Plaid credentials or API calls.
 *
 * Query Parameters:
 * - userId (optional): User ID to create streams for (default: IKzBkwEZb6MdJkdDVnVyTFAFj5i1)
 * - groupId (optional): Group ID for streams (default: test-family-1)
 * - permutation (optional): Which test scenario to run (default: standard)
 *
 * Available Permutations:
 * - "standard": Your provided Plaid response (1 inflow, 2 outflows)
 *
 * Example Usage:
 * GET http://127.0.0.1:5001/family-budget-app-cb59b/us-central1/simulatePlaidRecurring?permutation=standard
 */
export declare const simulatePlaidRecurring: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=simulatePlaidRecurring.d.ts.map