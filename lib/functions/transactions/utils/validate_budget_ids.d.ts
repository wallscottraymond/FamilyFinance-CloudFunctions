/**
 * Budget ID Validation Utility
 *
 * Validates that budgetIds in transaction splits reference valid, active budgets.
 * Auto-fixes invalid budgetIds to the user's "Everything Else" system budget.
 *
 * @module transactions/utils/validate_budget_ids
 */
import { TransactionSplit } from '../../../types';
/**
 * Validate and auto-fix budgetIds in transaction splits
 *
 * Checks that each budgetId exists and is active. If invalid budgetIds are found,
 * automatically reassigns them to the user's "Everything Else" system budget.
 *
 * @param user_id - User ID for querying user-specific budgets
 * @param splits - Array of transaction splits to validate
 * @returns Array of splits with validated/fixed budgetIds
 */
export declare function validate_and_fix_budget_ids(user_id: string, splits: TransactionSplit[]): Promise<TransactionSplit[]>;
/**
 * Check if a single budgetId is valid for a user
 *
 * Utility function for single-budget validation (e.g., manual budget assignment)
 *
 * @param user_id - User ID
 * @param budget_id - Budget ID to validate
 * @returns True if budget exists and is active, false otherwise
 */
export declare function is_valid_budget_id(user_id: string, budget_id: string): Promise<boolean>;
export { validate_and_fix_budget_ids as validateAndFixBudgetIds, is_valid_budget_id as isValidBudgetId };
//# sourceMappingURL=validate_budget_ids.d.ts.map