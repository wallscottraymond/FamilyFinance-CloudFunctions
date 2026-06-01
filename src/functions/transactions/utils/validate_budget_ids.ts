/**
 * Budget ID Validation Utility
 *
 * Validates that budgetIds in transaction splits reference valid, active budgets.
 * Auto-fixes invalid budgetIds to the user's "Everything Else" system budget.
 *
 * @module transactions/utils/validate_budget_ids
 */

import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { TransactionSplit } from '../../../types';

const db = getFirestore();

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
export async function validate_and_fix_budget_ids(
  user_id: string,
  splits: TransactionSplit[]
): Promise<TransactionSplit[]> {
  console.log(`[validate_budget_ids] Validating ${splits.length} splits for user: ${user_id}`);

  // Step 1: Collect all unique budgetIds from splits (exclude 'unassigned' and 'auto')
  const budget_ids = [
    ...new Set(
      splits
        .map(s => s.budgetId)
        .filter(id => id && id !== 'unassigned' && id !== 'auto')
    )
  ];

  if (budget_ids.length === 0) {
    console.log('[validate_budget_ids] No budgetIds to validate (all unassigned or auto)');
    return splits;
  }

  console.log(`[validate_budget_ids] Checking ${budget_ids.length} unique budgetIds: ${budget_ids.join(', ')}`);

  try {
    // Step 2: Fetch budgets to check existence and active status
    // Note: Firestore 'in' operator has a limit of 30 values
    const valid_budget_ids = new Set<string>();
    const budget_names = new Map<string, string>(); // Map budgetId -> budgetName

    // Process in batches of 30
    for (let i = 0; i < budget_ids.length; i += 30) {
      const batch_ids = budget_ids.slice(i, i + 30);

      const budgets_snapshot = await db.collection('budgets')
        .where('userId', '==', user_id)
        .where('isActive', '==', true)
        .where(FieldPath.documentId(), 'in', batch_ids)
        .get();

      budgets_snapshot.docs.forEach(doc => {
        valid_budget_ids.add(doc.id);
        const budget_data = doc.data();
        budget_names.set(doc.id, budget_data.name || 'General');
      });
    }

    console.log(`[validate_budget_ids] Found ${valid_budget_ids.size} valid budgets out of ${budget_ids.length}`);

    // Step 3: Find "Everything Else" budget as fallback
    const everything_else_snapshot = await db.collection('budgets')
      .where('userId', '==', user_id)
      .where('isSystemEverythingElse', '==', true)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    const everything_else_budget_id = everything_else_snapshot.empty
      ? null
      : everything_else_snapshot.docs[0].id;

    const everything_else_budget_name = everything_else_snapshot.empty
      ? null
      : (everything_else_snapshot.docs[0].data().name || 'Everything Else');

    if (!everything_else_budget_id) {
      console.warn('[validate_budget_ids] WARNING: No "Everything Else" budget found for user. Invalid budgetIds will remain unchanged.');
    } else {
      // Add "everything else" budget to the maps
      budget_names.set(everything_else_budget_id, everything_else_budget_name!);
    }

    // Step 4: Fix invalid budgetIds and set budgetNames
    let fixed_count = 0;
    const fixed_splits = splits.map(split => {
      // Skip validation for 'unassigned' and 'auto' special values
      if (!split.budgetId || split.budgetId === 'unassigned' || split.budgetId === 'auto') {
        return split;
      }

      // Check if budgetId is valid
      if (!valid_budget_ids.has(split.budgetId)) {
        console.warn(
          `[validate_budget_ids] Invalid budgetId: ${split.budgetId} (split: ${split.splitId}) - ` +
          `auto-fixing to ${everything_else_budget_id || 'unassigned'}`
        );
        fixed_count++;

        return {
          ...split,
          budgetId: everything_else_budget_id || 'unassigned',
          budgetName: everything_else_budget_id ? everything_else_budget_name : undefined
        };
      }

      // Valid budgetId - set budgetName if not already set
      if (!split.budgetName && budget_names.has(split.budgetId)) {
        return {
          ...split,
          budgetName: budget_names.get(split.budgetId)
        };
      }

      return split;
    });

    if (fixed_count > 0) {
      console.log(`[validate_budget_ids] Auto-fixed ${fixed_count} invalid budgetIds`);
    } else {
      console.log('[validate_budget_ids] All budgetIds valid ✓');
    }

    return fixed_splits;

  } catch (error) {
    console.error('[validate_budget_ids] Error validating budgetIds:', error);
    // On error, return original splits to avoid blocking transaction creation
    return splits;
  }
}

/**
 * Check if a single budgetId is valid for a user
 *
 * Utility function for single-budget validation (e.g., manual budget assignment)
 *
 * @param user_id - User ID
 * @param budget_id - Budget ID to validate
 * @returns True if budget exists and is active, false otherwise
 */
export async function is_valid_budget_id(
  user_id: string,
  budget_id: string
): Promise<boolean> {
  // Special values are always valid
  if (!budget_id || budget_id === 'unassigned' || budget_id === 'auto') {
    return true;
  }

  try {
    const budget_doc = await db.collection('budgets')
      .doc(budget_id)
      .get();

    if (!budget_doc.exists) {
      return false;
    }

    const budget_data = budget_doc.data();
    return budget_data?.userId === user_id && budget_data?.isActive === true;

  } catch (error) {
    console.error('[is_valid_budget_id] Error checking budgetId:', error);
    return false;
  }
}

// Legacy exports for backward compatibility
export {
  validate_and_fix_budget_ids as validateAndFixBudgetIds,
  is_valid_budget_id as isValidBudgetId
};
