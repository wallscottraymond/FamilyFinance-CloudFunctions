/**
 * Category Transfer Utility
 *
 * Handles atomic transfer of categories between budgets using Firestore transactions.
 * Ensures category ownership is always consistent (one budget per category per user).
 *
 * Key functions:
 * - claimCategories: Transfer categories TO a budget (from current owners)
 * - releaseCategories: Transfer categories FROM a budget (to Everything Else)
 * - transferCategories: Low-level transfer between specific budgets
 *
 * @module budgets/utils/categoryTransfer
 */
/**
 * Result of a category transfer operation
 */
export interface TransferResult {
    /** Whether the overall operation succeeded */
    success: boolean;
    /** Category IDs that were successfully transferred */
    transferred: string[];
    /** Category IDs that were already owned by the target budget */
    alreadyOwned: string[];
    /** Category IDs that were skipped (e.g., not found, invalid) */
    skipped: string[];
    /** Error messages for any failures */
    errors: string[];
}
/**
 * Transfer categories to a budget, auto-detecting current owners
 *
 * For each category:
 * 1. If owned by another budget → remove from that budget, add to target
 * 2. If owned by "Everything Else" → remove from EE, add to target
 * 3. If unassigned → just add to target
 * 4. If already owned by target → skip (no-op)
 *
 * Uses Firestore transaction for atomicity.
 *
 * @param userId - User ID for ownership lookup
 * @param categoryIds - Category IDs to claim
 * @param toBudgetId - Target budget to transfer categories to
 * @returns TransferResult with details of the operation
 */
export declare function claimCategories(userId: string, categoryIds: string[], toBudgetId: string): Promise<TransferResult>;
/**
 * Release categories from a budget back to "Everything Else"
 *
 * Removes categories from the source budget and adds them to the
 * "Everything Else" budget. Used when:
 * - Budget is deleted
 * - User removes categories from a budget
 *
 * Uses Firestore transaction for atomicity.
 *
 * @param userId - User ID for ownership lookup
 * @param categoryIds - Category IDs to release
 * @param fromBudgetId - Budget to release categories from
 * @returns TransferResult with details of the operation
 */
export declare function releaseCategories(userId: string, categoryIds: string[], fromBudgetId: string): Promise<TransferResult>;
/**
 * Transfer categories directly between two specific budgets
 *
 * Low-level function for explicit transfers. For most use cases,
 * prefer claimCategories() or releaseCategories().
 *
 * @param categoryIds - Category IDs to transfer
 * @param fromBudgetId - Source budget (null to skip removal)
 * @param toBudgetId - Target budget (null to skip addition)
 * @returns TransferResult with details of the operation
 */
export declare function transferCategories(categoryIds: string[], fromBudgetId: string | null, toBudgetId: string | null): Promise<TransferResult>;
/**
 * Bulk transfer request for multiple category movements
 */
export interface BulkTransferRequest {
    categoryId: string;
    fromBudgetId: string | null;
    toBudgetId: string | null;
}
/**
 * Perform multiple category transfers in a single transaction
 *
 * Used by migration scripts and UI bulk reassignment.
 * Groups transfers by source/target for efficiency.
 *
 * @param transfers - Array of transfer requests
 * @returns TransferResult with combined results
 */
export declare function bulkTransferCategories(transfers: BulkTransferRequest[]): Promise<TransferResult>;
//# sourceMappingURL=categoryTransfer.d.ts.map