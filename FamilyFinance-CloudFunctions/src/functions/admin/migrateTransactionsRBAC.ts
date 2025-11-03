/**
 * Migration Function: Add RBAC Fields to Existing Transactions
 *
 * This admin function migrates existing transactions to the new RBAC system
 * by adding groupId, accessibleBy, isPrivate, and other RBAC fields.
 *
 * Migration Strategy:
 * - Add RBAC fields to all transactions missing them
 * - Calculate accessibleBy from family/group membership
 * - Set groupId from familyId
 * - Set isPrivate based on groupId presence
 * - Preserve all existing data
 *
 * Security: Admin-only function
 * Memory: 1GiB, Timeout: 540s (9 minutes)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { Transaction } from '../../types';

interface MigrationStats {
  totalTransactions: number;
  migratedTransactions: number;
  skippedTransactions: number;
  errorTransactions: number;
  errors: string[];
}

export const migrateTransactionsRBAC = onCall({
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 540,
}, async (request) => {
  try {
    // Validate admin authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated');
    }

    // Check if user is admin
    const userDoc = await admin.firestore().collection('users').doc(request.auth.uid).get();
    if (!userDoc.exists) {
      throw new HttpsError('not-found', 'User not found');
    }

    const userData = userDoc.data()!;
    if (userData.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Only administrators can run migration functions');
    }

    console.log(`Starting RBAC transaction migration initiated by admin: ${request.auth.uid}`);

    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();

    const migrationStats: MigrationStats = {
      totalTransactions: 0,
      migratedTransactions: 0,
      skippedTransactions: 0,
      errorTransactions: 0,
      errors: []
    };

    // Query all transactions that don't have RBAC fields (need migration)
    const transactionsQuery = db.collection('transactions');

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

          // Skip if already has RBAC fields
          if (transactionData.accessibleBy && transactionData.createdBy && transactionData.ownerId !== undefined) {
            migrationStats.skippedTransactions++;
            continue;
          }

          // Determine groupId from familyId
          const groupId = transactionData.familyId || null;

          // Calculate accessibleBy based on group membership
          let accessibleBy = [transactionData.userId];

          if (groupId) {
            // Try to fetch group/family to get members
            const groupDoc = await db.collection('groups').doc(groupId).get() ||
                             await db.collection('families').doc(groupId).get();

            if (groupDoc.exists) {
              const groupData = groupDoc.data()!;
              const members = groupData.members || groupData.memberIds || [];

              // Extract member IDs
              if (Array.isArray(members)) {
                members.forEach((member: any) => {
                  const memberId = typeof member === 'string' ? member : member.userId;
                  if (memberId && !accessibleBy.includes(memberId)) {
                    accessibleBy.push(memberId);
                  }
                });
              }
            }
          }

          // Prepare transaction update with RBAC fields
          const transactionUpdate = {
            // === NEW RBAC FIELDS ===
            createdBy: transactionData.userId || transactionData.createdBy,
            ownerId: transactionData.userId || transactionData.ownerId,
            groupId,
            isPrivate: !groupId,
            accessibleBy,

            // Update timestamp
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

    console.log('RBAC transaction migration completed:', migrationStats);

    return {
      success: true,
      stats: migrationStats,
      message: `Migration completed. Migrated ${migrationStats.migratedTransactions} transactions, skipped ${migrationStats.skippedTransactions}, errors: ${migrationStats.errorTransactions}`,
    };

  } catch (error) {
    console.error('Error in RBAC transaction migration:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Migration failed');
  }
});

/**
 * Helper function to verify RBAC migration results
 */
export const verifyTransactionsRBAC = onCall({
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

    // Sample transactions to check structure
    const sampleSnapshot = await db.collection('transactions')
      .limit(10)
      .get();

    const withRBAC = sampleSnapshot.docs.filter(doc => {
      const data = doc.data();
      return data.accessibleBy && data.createdBy && data.ownerId !== undefined;
    }).length;

    const withoutRBAC = sampleSnapshot.docs.length - withRBAC;

    const sampleTransactions = sampleSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        hasRBACFields: !!(data.accessibleBy && data.createdBy && data.ownerId !== undefined),
        hasGroupId: !!data.groupId,
        hasAccessibleBy: !!data.accessibleBy,
        isPrivate: data.isPrivate,
        accessibleByCount: data.accessibleBy?.length || 0,
        userId: data.userId,
        familyId: data.familyId,
      };
    });

    return {
      success: true,
      verification: {
        totalTransactions,
        sampleSize: sampleSnapshot.docs.length,
        sampleWithRBAC: withRBAC,
        sampleWithoutRBAC: withoutRBAC,
        estimatedMigrationCompleteness: `${Math.round((withRBAC / sampleSnapshot.docs.length) * 100)}%`,
        sampleTransactions,
      },
      message: withoutRBAC === 0
        ? 'Migration verification successful - sample transactions have RBAC fields'
        : `Sample shows ${withoutRBAC} transactions still need migration`,
    };

  } catch (error) {
    console.error('Error in verification:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'Verification failed');
  }
});
