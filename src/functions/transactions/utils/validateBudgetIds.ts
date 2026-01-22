/**
 * Budget ID Validation Utility
 *
 * Validates that budgetIds in transaction splits reference valid, active budgets.
 * Auto-fixes invalid budgetIds to the user's "Everything Else" system budget.
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
 * @param userId - User ID for querying user-specific budgets
 * @param splits - Array of transaction splits to validate
 * @returns Array of splits with validated/fixed budgetIds
 */
export async function validateAndFixBudgetIds(
  userId: string,
  splits: TransactionSplit[]
): Promise<TransactionSplit[]> {
  console.log(`[validateBudgetIds] Validating ${splits.length} splits for user: ${userId}`);

  // Step 1: Collect all unique budgetIds from splits (exclude 'unassigned' and 'auto')
  const budgetIds = [
    ...new Set(
      splits
        .map(s => s.budgetId)
        .filter(id => id && id !== 'unassigned' && id !== 'auto')
    )
  ];

  if (budgetIds.length === 0) {
    console.log('[validateBudgetIds] No budgetIds to validate (all unassigned or auto)');
    return splits;
  }

  console.log(`[validateBudgetIds] Checking ${budgetIds.length} unique budgetIds: ${budgetIds.join(', ')}`);

  try {
    // Step 2: Fetch budgets to check existence and active status
    // Note: Firestore 'in' operator has a limit of 30 values
    const validBudgetIds = new Set<string>();
    const budgetNames = new Map<string, string>(); // Map budgetId -> budgetName

    // Process in batches of 30
    for (let i = 0; i < budgetIds.length; i += 30) {
      const batchIds = budgetIds.slice(i, i + 30);

      const budgetsSnapshot = await db.collection('budgets')
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .where(FieldPath.documentId(), 'in', batchIds)
        .get();

      budgetsSnapshot.docs.forEach(doc => {
        validBudgetIds.add(doc.id);
        const budgetData = doc.data();
        budgetNames.set(doc.id, budgetData.name || 'General');
      });
    }

    console.log(`[validateBudgetIds] Found ${validBudgetIds.size} valid budgets out of ${budgetIds.length}`);

    // Step 3: Find "Everything Else" budget as fallback
    const everythingElseSnapshot = await db.collection('budgets')
      .where('userId', '==', userId)
      .where('isSystemEverythingElse', '==', true)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    const everythingElseBudgetId = everythingElseSnapshot.empty
      ? null
      : everythingElseSnapshot.docs[0].id;

    const everythingElseBudgetName = everythingElseSnapshot.empty
      ? null
      : (everythingElseSnapshot.docs[0].data().name || 'Everything Else');

    if (!everythingElseBudgetId) {
      console.warn('[validateBudgetIds] WARNING: No "Everything Else" budget found for user. Invalid budgetIds will remain unchanged.');
    } else {
      // Add "everything else" budget to the maps
      budgetNames.set(everythingElseBudgetId, everythingElseBudgetName!);
    }

    // Step 4: Fix invalid budgetIds and set budgetNames
    let fixedCount = 0;
    const fixedSplits = splits.map(split => {
      // Skip validation for 'unassigned' and 'auto' special values
      if (!split.budgetId || split.budgetId === 'unassigned' || split.budgetId === 'auto') {
        return split;
      }

      // Check if budgetId is valid
      if (!validBudgetIds.has(split.budgetId)) {
        console.warn(
          `[validateBudgetIds] Invalid budgetId: ${split.budgetId} (split: ${split.splitId}) - ` +
          `auto-fixing to ${everythingElseBudgetId || 'unassigned'}`
        );
        fixedCount++;

        return {
          ...split,
          budgetId: everythingElseBudgetId || 'unassigned',
          budgetName: everythingElseBudgetId ? everythingElseBudgetName : undefined
        };
      }

      // Valid budgetId - set budgetName if not already set
      if (!split.budgetName && budgetNames.has(split.budgetId)) {
        return {
          ...split,
          budgetName: budgetNames.get(split.budgetId)
        };
      }

      return split;
    });

    if (fixedCount > 0) {
      console.log(`[validateBudgetIds] Auto-fixed ${fixedCount} invalid budgetIds`);
    } else {
      console.log('[validateBudgetIds] All budgetIds valid ✓');
    }

    return fixedSplits;

  } catch (error) {
    console.error('[validateBudgetIds] Error validating budgetIds:', error);
    // On error, return original splits to avoid blocking transaction creation
    return splits;
  }
}

/**
 * Check if a single budgetId is valid for a user
 *
 * Utility function for single-budget validation (e.g., manual budget assignment)
 *
 * @param userId - User ID
 * @param budgetId - Budget ID to validate
 * @returns True if budget exists and is active, false otherwise
 */
export async function isValidBudgetId(
  userId: string,
  budgetId: string
): Promise<boolean> {
  // Special values are always valid
  if (!budgetId || budgetId === 'unassigned' || budgetId === 'auto') {
    return true;
  }

  try {
    const budgetDoc = await db.collection('budgets')
      .doc(budgetId)
      .get();

    if (!budgetDoc.exists) {
      return false;
    }

    const budgetData = budgetDoc.data();
    return budgetData?.userId === userId && budgetData?.isActive === true;

  } catch (error) {
    console.error('[isValidBudgetId] Error checking budgetId:', error);
    return false;
  }
}
