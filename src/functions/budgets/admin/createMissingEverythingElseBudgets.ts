/**
 * Admin function to create "everything else" budgets for existing users
 *
 * This migration function backfills "everything else" budgets for users
 * who were created before the feature was implemented.
 *
 * Usage: firebase functions:call createMissingEverythingElseBudgets
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';
import { createEverythingElseBudget } from '../utils/createEverythingElseBudget';

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
export const createMissingEverythingElseBudgets = onCall({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 540, // 9 minutes for large migrations
}, async (request): Promise<MigrationResponse> => {
  console.log('🔧 [createMissingEverythingElseBudgets] Migration started');

  // 1. Authentication check
  if (!request.auth) {
    console.error('❌ [createMissingEverythingElseBudgets] Unauthenticated request');
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  // 2. Admin role check
  const isAdmin = request.auth.token?.role === 'admin';
  if (!isAdmin) {
    console.error(`❌ [createMissingEverythingElseBudgets] Non-admin user attempted migration: ${request.auth.uid}`);
    throw new HttpsError(
      'permission-denied',
      'Only admins can run migration functions'
    );
  }

  console.log(`✅ [createMissingEverythingElseBudgets] Admin verified: ${request.auth.uid}`);

  try {
    // 3. Query all active users
    console.log('📊 [createMissingEverythingElseBudgets] Querying active users...');
    const usersSnapshot = await db.collection('users')
      .where('isActive', '==', true)
      .get();

    if (usersSnapshot.empty) {
      console.warn('⚠️ [createMissingEverythingElseBudgets] No active users found');
      return {
        success: true,
        summary: {
          totalUsers: 0,
          budgetsCreated: 0,
          budgetsSkipped: 0,
          errors: 0,
          timestamp: Timestamp.now()
        }
      };
    }

    console.log(`📋 [createMissingEverythingElseBudgets] Found ${usersSnapshot.docs.length} active users`);

    // 4. Initialize counters
    let budgetsCreated = 0;
    let budgetsSkipped = 0;
    let errorCount = 0;
    const errorDetails: MigrationError[] = [];

    // 5. Process each user
    for (let i = 0; i < usersSnapshot.docs.length; i++) {
      const userDoc = usersSnapshot.docs[i];
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Log progress every 10 users
      if ((i + 1) % 10 === 0) {
        const progressPercentage = ((i + 1) / usersSnapshot.docs.length * 100).toFixed(1);
        console.log(`📈 [createMissingEverythingElseBudgets] Progress: ${i + 1}/${usersSnapshot.docs.length} (${progressPercentage}%)`);
      }

      try {
        // 6. Check if user already has "everything else" budget
        const existingBudgetQuery = await db.collection('budgets')
          .where('userId', '==', userId)
          .where('isSystemEverythingElse', '==', true)
          .get();

        if (!existingBudgetQuery.empty) {
          // User already has the budget - skip
          console.log(`⏭️ [createMissingEverythingElseBudgets] User ${userId} already has "everything else" budget`);
          budgetsSkipped++;
          continue;
        }

        // 7. Create "everything else" budget for user
        const userCurrency = userData.preferences?.currency || 'USD';
        const budgetId = await createEverythingElseBudget(db, userId, userCurrency);

        console.log(`✅ [createMissingEverythingElseBudgets] Created "everything else" budget for user ${userId}: ${budgetId}`);
        budgetsCreated++;

      } catch (error: any) {
        // 8. Handle individual user error - continue processing other users
        console.error(`❌ [createMissingEverythingElseBudgets] Error processing user ${userId}:`, error);
        errorCount++;
        errorDetails.push({
          userId,
          error: error.message || 'Unknown error'
        });
      }
    }

    // 9. Return summary
    const summary: MigrationSummary = {
      totalUsers: usersSnapshot.docs.length,
      budgetsCreated,
      budgetsSkipped,
      errors: errorCount,
      timestamp: Timestamp.now()
    };

    console.log('🎉 [createMissingEverythingElseBudgets] Migration completed:', summary);

    return {
      success: true,
      summary,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined
    };

  } catch (error: any) {
    // 10. Handle complete failure
    console.error('❌ [createMissingEverythingElseBudgets] Migration failed:', error);
    return {
      success: false,
      error: {
        code: 'migration-failed',
        message: error.message || 'Failed to complete migration'
      }
    };
  }
});
