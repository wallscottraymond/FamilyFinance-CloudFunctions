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

import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getCategoryOwnership } from './categoryOwnership';

const db = getFirestore();

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
export async function claimCategories(
  userId: string,
  categoryIds: string[],
  toBudgetId: string
): Promise<TransferResult> {
  console.log(`[categoryTransfer] Claiming ${categoryIds.length} categories for budget ${toBudgetId}`);

  if (categoryIds.length === 0) {
    return {
      success: true,
      transferred: [],
      alreadyOwned: [],
      skipped: [],
      errors: [],
    };
  }

  try {
    // Get current ownership map
    const ownershipMap = await getCategoryOwnership(userId);

    // Categorize what needs to happen
    const toTransfer: Array<{ categoryId: string; fromBudgetId: string | null }> = [];
    const alreadyOwned: string[] = [];
    const skipped: string[] = [];

    for (const categoryId of categoryIds) {
      const currentOwner = ownershipMap.ownership[categoryId];

      if (currentOwner === toBudgetId) {
        // Already owned by target
        alreadyOwned.push(categoryId);
      } else if (currentOwner === null) {
        // Unassigned - need to remove from Everything Else if it exists
        toTransfer.push({
          categoryId,
          fromBudgetId: ownershipMap.everythingElseBudgetId,
        });
      } else {
        // Owned by another budget - transfer from there
        toTransfer.push({
          categoryId,
          fromBudgetId: currentOwner,
        });
      }
    }

    if (toTransfer.length === 0) {
      console.log(`[categoryTransfer] No categories to transfer (${alreadyOwned.length} already owned)`);
      return {
        success: true,
        transferred: [],
        alreadyOwned,
        skipped,
        errors: [],
      };
    }

    // Execute transfer in a transaction
    const transferred: string[] = [];
    const errors: string[] = [];

    await db.runTransaction(async (transaction) => {
      const toBudgetRef = db.collection('budgets').doc(toBudgetId);
      const toBudgetDoc = await transaction.get(toBudgetRef);

      if (!toBudgetDoc.exists) {
        throw new Error(`Target budget ${toBudgetId} not found`);
      }

      // Group transfers by source budget for efficiency
      const transfersBySource = new Map<string | null, string[]>();
      for (const { categoryId, fromBudgetId } of toTransfer) {
        const key = fromBudgetId;
        if (!transfersBySource.has(key)) {
          transfersBySource.set(key, []);
        }
        transfersBySource.get(key)!.push(categoryId);
      }

      // Remove from source budgets
      for (const [fromBudgetId, categoryIdsToRemove] of transfersBySource) {
        if (fromBudgetId) {
          const fromBudgetRef = db.collection('budgets').doc(fromBudgetId);
          transaction.update(fromBudgetRef, {
            categoryIds: FieldValue.arrayRemove(...categoryIdsToRemove),
            updatedAt: Timestamp.now(),
          });
          console.log(`[categoryTransfer] Removing ${categoryIdsToRemove.length} categories from budget ${fromBudgetId}`);
        }
      }

      // Add to target budget
      const allCategoriesToAdd = toTransfer.map(t => t.categoryId);
      transaction.update(toBudgetRef, {
        categoryIds: FieldValue.arrayUnion(...allCategoriesToAdd),
        updatedAt: Timestamp.now(),
      });
      console.log(`[categoryTransfer] Adding ${allCategoriesToAdd.length} categories to budget ${toBudgetId}`);

      transferred.push(...allCategoriesToAdd);
    });

    console.log(`[categoryTransfer] Successfully transferred ${transferred.length} categories`);
    return {
      success: true,
      transferred,
      alreadyOwned,
      skipped,
      errors,
    };

  } catch (error: any) {
    console.error(`[categoryTransfer] Error claiming categories:`, error);
    return {
      success: false,
      transferred: [],
      alreadyOwned: [],
      skipped: categoryIds,
      errors: [error.message || 'Unknown error'],
    };
  }
}

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
export async function releaseCategories(
  userId: string,
  categoryIds: string[],
  fromBudgetId: string
): Promise<TransferResult> {
  console.log(`[categoryTransfer] Releasing ${categoryIds.length} categories from budget ${fromBudgetId}`);

  if (categoryIds.length === 0) {
    return {
      success: true,
      transferred: [],
      alreadyOwned: [],
      skipped: [],
      errors: [],
    };
  }

  try {
    // Get current ownership to find Everything Else budget
    const ownershipMap = await getCategoryOwnership(userId);

    if (!ownershipMap.everythingElseBudgetId) {
      console.warn(`[categoryTransfer] No "Everything Else" budget found for user ${userId}`);
      return {
        success: false,
        transferred: [],
        alreadyOwned: [],
        skipped: categoryIds,
        errors: ['No "Everything Else" budget found'],
      };
    }

    const everythingElseBudgetId = ownershipMap.everythingElseBudgetId;

    // Execute transfer in a transaction
    const transferred: string[] = [];

    await db.runTransaction(async (transaction) => {
      const fromBudgetRef = db.collection('budgets').doc(fromBudgetId);
      const toBudgetRef = db.collection('budgets').doc(everythingElseBudgetId);

      const [fromBudgetDoc, toBudgetDoc] = await Promise.all([
        transaction.get(fromBudgetRef),
        transaction.get(toBudgetRef),
      ]);

      if (!fromBudgetDoc.exists) {
        throw new Error(`Source budget ${fromBudgetId} not found`);
      }

      if (!toBudgetDoc.exists) {
        throw new Error(`"Everything Else" budget ${everythingElseBudgetId} not found`);
      }

      // Remove from source budget
      transaction.update(fromBudgetRef, {
        categoryIds: FieldValue.arrayRemove(...categoryIds),
        updatedAt: Timestamp.now(),
      });

      // Add to Everything Else budget
      transaction.update(toBudgetRef, {
        categoryIds: FieldValue.arrayUnion(...categoryIds),
        updatedAt: Timestamp.now(),
      });

      transferred.push(...categoryIds);
    });

    console.log(`[categoryTransfer] Successfully released ${transferred.length} categories to "Everything Else"`);
    return {
      success: true,
      transferred,
      alreadyOwned: [],
      skipped: [],
      errors: [],
    };

  } catch (error: any) {
    console.error(`[categoryTransfer] Error releasing categories:`, error);
    return {
      success: false,
      transferred: [],
      alreadyOwned: [],
      skipped: categoryIds,
      errors: [error.message || 'Unknown error'],
    };
  }
}

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
export async function transferCategories(
  categoryIds: string[],
  fromBudgetId: string | null,
  toBudgetId: string | null
): Promise<TransferResult> {
  console.log(`[categoryTransfer] Direct transfer of ${categoryIds.length} categories: ${fromBudgetId} → ${toBudgetId}`);

  if (categoryIds.length === 0) {
    return {
      success: true,
      transferred: [],
      alreadyOwned: [],
      skipped: [],
      errors: [],
    };
  }

  if (!fromBudgetId && !toBudgetId) {
    return {
      success: false,
      transferred: [],
      alreadyOwned: [],
      skipped: categoryIds,
      errors: ['Both fromBudgetId and toBudgetId are null'],
    };
  }

  try {
    const transferred: string[] = [];

    await db.runTransaction(async (transaction) => {
      // Remove from source if specified
      if (fromBudgetId) {
        const fromBudgetRef = db.collection('budgets').doc(fromBudgetId);
        const fromBudgetDoc = await transaction.get(fromBudgetRef);

        if (!fromBudgetDoc.exists) {
          throw new Error(`Source budget ${fromBudgetId} not found`);
        }

        transaction.update(fromBudgetRef, {
          categoryIds: FieldValue.arrayRemove(...categoryIds),
          updatedAt: Timestamp.now(),
        });
      }

      // Add to target if specified
      if (toBudgetId) {
        const toBudgetRef = db.collection('budgets').doc(toBudgetId);
        const toBudgetDoc = await transaction.get(toBudgetRef);

        if (!toBudgetDoc.exists) {
          throw new Error(`Target budget ${toBudgetId} not found`);
        }

        transaction.update(toBudgetRef, {
          categoryIds: FieldValue.arrayUnion(...categoryIds),
          updatedAt: Timestamp.now(),
        });
      }

      transferred.push(...categoryIds);
    });

    console.log(`[categoryTransfer] Direct transfer successful: ${transferred.length} categories`);
    return {
      success: true,
      transferred,
      alreadyOwned: [],
      skipped: [],
      errors: [],
    };

  } catch (error: any) {
    console.error(`[categoryTransfer] Error in direct transfer:`, error);
    return {
      success: false,
      transferred: [],
      alreadyOwned: [],
      skipped: categoryIds,
      errors: [error.message || 'Unknown error'],
    };
  }
}

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
export async function bulkTransferCategories(
  transfers: BulkTransferRequest[]
): Promise<TransferResult> {
  console.log(`[categoryTransfer] Bulk transfer of ${transfers.length} category movements`);

  if (transfers.length === 0) {
    return {
      success: true,
      transferred: [],
      alreadyOwned: [],
      skipped: [],
      errors: [],
    };
  }

  try {
    // Group by operation type for efficiency
    const removals = new Map<string, string[]>(); // budgetId → categoryIds
    const additions = new Map<string, string[]>(); // budgetId → categoryIds

    for (const { categoryId, fromBudgetId, toBudgetId } of transfers) {
      if (fromBudgetId) {
        if (!removals.has(fromBudgetId)) {
          removals.set(fromBudgetId, []);
        }
        removals.get(fromBudgetId)!.push(categoryId);
      }

      if (toBudgetId) {
        if (!additions.has(toBudgetId)) {
          additions.set(toBudgetId, []);
        }
        additions.get(toBudgetId)!.push(categoryId);
      }
    }

    const transferred: string[] = [];

    await db.runTransaction(async (transaction) => {
      // Validate all budgets exist
      const allBudgetIds = new Set([...removals.keys(), ...additions.keys()]);
      const budgetRefs = Array.from(allBudgetIds).map(id => db.collection('budgets').doc(id));
      const budgetDocs = await Promise.all(budgetRefs.map(ref => transaction.get(ref)));

      for (let i = 0; i < budgetDocs.length; i++) {
        if (!budgetDocs[i].exists) {
          throw new Error(`Budget ${Array.from(allBudgetIds)[i]} not found`);
        }
      }

      // Process removals
      for (const [budgetId, categoryIds] of removals) {
        const budgetRef = db.collection('budgets').doc(budgetId);
        transaction.update(budgetRef, {
          categoryIds: FieldValue.arrayRemove(...categoryIds),
          updatedAt: Timestamp.now(),
        });
      }

      // Process additions
      for (const [budgetId, categoryIds] of additions) {
        const budgetRef = db.collection('budgets').doc(budgetId);
        transaction.update(budgetRef, {
          categoryIds: FieldValue.arrayUnion(...categoryIds),
          updatedAt: Timestamp.now(),
        });
      }

      transferred.push(...transfers.map(t => t.categoryId));
    });

    console.log(`[categoryTransfer] Bulk transfer successful: ${transferred.length} categories`);
    return {
      success: true,
      transferred,
      alreadyOwned: [],
      skipped: [],
      errors: [],
    };

  } catch (error: any) {
    console.error(`[categoryTransfer] Error in bulk transfer:`, error);
    return {
      success: false,
      transferred: [],
      alreadyOwned: [],
      skipped: transfers.map(t => t.categoryId),
      errors: [error.message || 'Unknown error'],
    };
  }
}
