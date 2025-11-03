/**
 * Migration Function: Add Default Splits to Existing Transactions
 * 
 * This admin function migrates existing transactions to the new splitting system
 * by adding default splits that allocate the full transaction amount to a single
 * budget based on existing budgetId or user's primary budget.
 * 
 * Migration Strategy:
 * - Add default splits array to all transactions without splits
 * - Set isSplit: false for single default splits
 * - Calculate totalAllocated, unallocated, and affected budget arrays
 * - Preserve backward compatibility with existing budgetId field
 * 
 * Security: Admin-only function
 * Memory: 1GiB, Timeout: 300s (5 minutes)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { 
  Transaction, 
  TransactionSplit
} from '../../types';

interface MigrationStats {
  totalTransactions: number;
  migratedTransactions: number;
  skippedTransactions: number;
  errorTransactions: number;
  errors: string[];
}

export const migrateTransactionsToSplits = onCall({
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 300,
}, async (request) => {
  try {
    // Validate admin authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Check if user is admin (you may need to adjust this based on your admin verification)
    const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data()!;
    if (userData.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only administrators can run migration functions');
    }

    console.log(`Starting transaction splits migration initiated by admin: ${request.auth.uid}`);

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    const migrationStats: MigrationStats = {
      totalTransactions: 0,
      migratedTransactions: 0,
      skippedTransactions: 0,
      errorTransactions: 0,
      errors: []
    };

    // Query all transactions that don't have splits (need migration)
    const transactionsQuery = db.collection('transactions')
      .where('splits', '==', null); // Query for transactions without splits

    let lastDoc: admin.firestore.QueryDocumentSnapshot | undefined;
    const BATCH_SIZE = 100;
    
    do {
      // Build query with pagination
      let query = transactionsQuery.limit(BATCH_SIZE);
      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const transactionsSnapshot = await query.get();
      
      if (transactionsSnapshot.empty) {
        break;
      }

      migrationStats.totalTransactions += transactionsSnapshot.size;
      lastDoc = transactionsSnapshot.docs[transactionsSnapshot.docs.length - 1];

      // Process transactions in batches
      const batch = db.batch();
      let batchCount = 0;

      for (const transactionDoc of transactionsSnapshot.docs) {
        try {
          const transactionData = transactionDoc.data() as Transaction;
          
          // Skip if already has splits
          if (transactionData.splits && transactionData.splits.length > 0) {
            migrationStats.skippedTransactions++;
            continue;
          }

          // Determine budget for default split
          let budgetId = transactionData.splits?.[0]?.budgetId; // Use first split's budgetId if exists
          let budgetPeriodId: string | undefined;
          let budgetName = 'General';

          // If transaction has a budgetId, try to find an active budget period
          if (budgetId) {
            const budgetPeriodsQuery = await db.collection('budget_periods')
              .where('budgetId', '==', budgetId)
              .where('userId', '==', transactionData.userId)
              .where('isActive', '==', true)
              .orderBy('periodStart', 'desc')
              .limit(1)
              .get();

            if (!budgetPeriodsQuery.empty) {
              const budgetPeriodDoc = budgetPeriodsQuery.docs[0];
              budgetPeriodId = budgetPeriodDoc.id;
              budgetName = budgetPeriodDoc.data().budgetName || budgetName;
            }
          }

          // If no budget period found, try to find a default one for the user
          if (!budgetPeriodId) {
            const userBudgetPeriodsQuery = await db.collection('budget_periods')
              .where('userId', '==', transactionData.userId)
              .where('isActive', '==', true)
              .orderBy('periodStart', 'desc')
              .limit(1)
              .get();

            if (!userBudgetPeriodsQuery.empty) {
              const budgetPeriodDoc = userBudgetPeriodsQuery.docs[0];
              budgetPeriodId = budgetPeriodDoc.id;
              budgetId = budgetPeriodDoc.data().budgetId;
              budgetName = budgetPeriodDoc.data().budgetName || budgetName;
            }
          }

          // Create default split
          const defaultSplit: TransactionSplit = {
            id: db.collection('_dummy').doc().id,
            budgetId: budgetId || 'unassigned',
            budgetName,
            categoryId: transactionData.categories?.primary || 'other',
            amount: transactionData.amount,
            description: null,
            isDefault: true,
            // Period IDs - migration script sets to null (can be backfilled later)
            monthlyPeriodId: null,
            weeklyPeriodId: null,
            biWeeklyPeriodId: null,
            // Assignment references
            outflowId: null,
            // Status fields
            isIgnored: false,
            isRefund: false,
            isTaxDeductible: false,
            ignoredReason: null,
            refundReason: null,
            taxDeductibleCategory: null,
            note: null,
            paymentDate: transactionData.date, // Payment date matches transaction date
            createdAt: transactionData.createdAt || now,
            updatedAt: now,
            createdBy: transactionData.userId || transactionData.access?.createdBy || '',
          };

          // Prepare transaction update
          const transactionUpdate = {
            splits: [defaultSplit],
            isSplit: false, // Single default split
            totalAllocated: transactionData.amount,
            unallocated: 0,
            affectedBudgets: budgetId ? [budgetId] : [],
            affectedBudgetPeriods: budgetPeriodId ? [budgetPeriodId] : [],
            primaryBudgetId: budgetId || undefined,
            primaryBudgetPeriodId: budgetPeriodId || undefined,
            updatedAt: now,
          };

          // Add to batch
          batch.update(transactionDoc.ref, transactionUpdate);
          batchCount++;
          migrationStats.migratedTransactions++;

        } catch (error) {
          console.error(`Error processing transaction ${transactionDoc.id}:`, error);
          migrationStats.errorTransactions++;
          migrationStats.errors.push(`Transaction ${transactionDoc.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // Commit batch if there are updates
      if (batchCount > 0) {
        await batch.commit();
        console.log(`Migrated batch of ${batchCount} transactions`);
      }

    } while (lastDoc);

    console.log('Transaction splits migration completed:', migrationStats);

    return {
      success: true,
      stats: migrationStats,
      message: `Migration completed. Migrated ${migrationStats.migratedTransactions} transactions, skipped ${migrationStats.skippedTransactions}, errors: ${migrationStats.errorTransactions}`,
    };

  } catch (error) {
    console.error('Error in transaction splits migration:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Migration failed');
  }
});

/**
 * Helper function to verify migration results
 */
export const verifyTransactionSplitsMigration = onCall({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => {
  try {
    // Validate admin authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data()!;
    if (userData.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only administrators can run verification functions');
    }

    const db = admin.firestore();

    // Count total transactions
    const totalTransactionsSnapshot = await db.collection('transactions').count().get();
    const totalTransactions = totalTransactionsSnapshot.data().count;

    // Count transactions with splits
    const transactionsWithSplitsSnapshot = await db.collection('transactions')
      .where('splits', '!=', null)
      .count()
      .get();
    const transactionsWithSplits = transactionsWithSplitsSnapshot.data().count;

    // Count transactions without splits
    const transactionsWithoutSplits = totalTransactions - transactionsWithSplits;

    // Sample a few transactions to check structure
    const sampleSnapshot = await db.collection('transactions')
      .where('splits', '!=', null)
      .limit(5)
      .get();

    const sampleTransactions = sampleSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        amount: data.amount,
        splitsCount: data.splits?.length || 0,
        totalAllocated: data.totalAllocated,
        unallocated: data.unallocated,
        isSplit: data.isSplit,
        hasAffectedBudgets: !!data.affectedBudgets?.length,
        hasAffectedBudgetPeriods: !!data.affectedBudgetPeriods?.length,
      };
    });

    return {
      success: true,
      verification: {
        totalTransactions,
        transactionsWithSplits,
        transactionsWithoutSplits,
        migrationCompleteness: transactionsWithoutSplits === 0,
        sampleTransactions,
      },
      message: transactionsWithoutSplits === 0 
        ? 'Migration verification successful - all transactions have splits'
        : `Migration incomplete - ${transactionsWithoutSplits} transactions still need migration`,
    };

  } catch (error) {
    console.error('Error in verification:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Verification failed');
  }
});