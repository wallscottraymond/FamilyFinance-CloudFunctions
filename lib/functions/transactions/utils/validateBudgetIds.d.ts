/**
 * Budget ID Validation Utility
 *
 * Validates that budgetIds in transaction splits reference valid, active budgets.
 * Auto-fixes invalid budgetIds to the user's "Everything Else" system budget.
 */
import { TransactionSplit } from '../../../types';
/**
 * Validate and auto-fix budgetIds in transaction splits
 *
 * Checks that each budgetId exists and is active. If invalid budgetIds are found,
 * automatically reassigns them to the user's "Everything Else" system budget.
 *
 * @param userId - User ID for querying user-specific budgets
 * @param splits - Array of transaction splits to validate
 * @returns Array of splits with validated/fixed budgetIds
 */
export declare function validateAndFixBudgetIds(userId: string, splits: TransactionSplit[]): Promise<TransactionSplit[]>;
/**
 * Check if a single budgetId is valid for a user
 *
 * Utility function for single-budget validation (e.g., manual budget assignment)
 *
 * @param userId - User ID
 * @param budgetId - Budget ID to validate
 * @returns True if budget exists and is active, false otherwise
 */
export declare function isValidBudgetId(userId: string, budgetId: string): Promise<boolean>;
//# sourceMappingURL=validateBudgetIds.d.ts.map