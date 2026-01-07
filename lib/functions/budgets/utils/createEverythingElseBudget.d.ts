/**
 * createEverythingElseBudget - System Budget Creation Utility
 *
 * Creates the "everything else" budget - a permanent catch-all budget that
 * captures transaction splits not assigned to any other budget.
 *
 * Key Characteristics:
 * - Auto-created for users on signup
 * - Cannot be deleted by users
 * - Amount is always $0 (calculated from spending)
 * - Name is editable, but other fields are not
 * - Lowest priority in transaction matching (fallback)
 *
 * @module budgets/utils/createEverythingElseBudget
 */
import { Firestore } from 'firebase-admin/firestore';
/**
 * Creates the "everything else" system budget for a user
 *
 * This budget acts as a catch-all for transactions that don't match any other budget.
 * It's automatically created on user signup and cannot be deleted.
 *
 * @param db - Firestore database instance
 * @param userId - User ID to create budget for
 * @param userCurrency - User's preferred currency (default: 'USD')
 * @returns Promise<string> - The created (or existing) budget document ID
 *
 * @throws Error if userId is missing or invalid
 * @throws Error if currency format is invalid
 * @throws Error if Firestore operation fails
 *
 * @example
 * ```typescript
 * // Create budget for new user
 * const budgetId = await createEverythingElseBudget(db, 'user-123', 'USD');
 *
 * // Budget will be created with:
 * // - isSystemEverythingElse: true
 * // - name: 'Everything Else'
 * // - amount: 0
 * // - categoryIds: [] (catches all categories)
 * ```
 */
export declare function createEverythingElseBudget(db: Firestore, userId: string, userCurrency?: string): Promise<string>;
//# sourceMappingURL=createEverythingElseBudget.d.ts.map