/**
 * Migration Script: Add transactionSplits field to existing outflow_periods
 *
 * This admin function updates all existing outflow_periods documents to include
 * the new transactionSplits field initialized as an empty array.
 *
 * Usage: Call via HTTPS endpoint
 * https://us-central1-{project}.cloudfunctions.net/migrateOutflowPeriodsTransactionSplits
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

export const migrateOutflowPeriodsTransactionSplits = onRequest({
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 540, // 9 minutes max
}, async (request, response) => {
  try {
    console.log('[migrateOutflowPeriodsTransactionSplits] Starting migration...');

    const db = admin.firestore();
    const outflowPeriodsRef = db.collection('outflow_periods');

    // Get all outflow_periods documents
    const snapshot = await outflowPeriodsRef.get();

    if (snapshot.empty) {
      console.log('[migrateOutflowPeriodsTransactionSplits] No outflow periods found');
      response.status(200).json({
        success: true,
        message: 'No outflow periods found to migrate',
        totalProcessed: 0,
        updated: 0,
        skipped: 0,
      });
      return;
    }

    console.log(`[migrateOutflowPeriodsTransactionSplits] Found ${snapshot.size} outflow periods`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const batchSize = 500; // Firestore batch write limit
    let batch = db.batch();
    let operationCount = 0;

    for (const doc of snapshot.docs) {
      try {
        const data = doc.data();

        // Check if transactionSplits field already exists
        if (data.hasOwnProperty('transactionSplits')) {
          console.log(`[migrateOutflowPeriodsTransactionSplits] Skipping ${doc.id} - already has transactionSplits field`);
          skipped++;
          continue;
        }

        // Add transactionSplits field as empty array
        batch.update(doc.ref, {
          transactionSplits: [],
          updatedAt: admin.firestore.Timestamp.now(),
        });

        updated++;
        operationCount++;

        // Commit batch when it reaches the limit
        if (operationCount >= batchSize) {
          await batch.commit();
          console.log(`[migrateOutflowPeriodsTransactionSplits] Committed batch of ${operationCount} updates`);
          batch = db.batch();
          operationCount = 0;
        }
      } catch (error) {
        console.error(`[migrateOutflowPeriodsTransactionSplits] Error processing ${doc.id}:`, error);
        errors++;
      }
    }

    // Commit any remaining operations in the batch
    if (operationCount > 0) {
      await batch.commit();
      console.log(`[migrateOutflowPeriodsTransactionSplits] Committed final batch of ${operationCount} updates`);
    }

    const result = {
      success: true,
      message: 'Migration completed successfully',
      totalProcessed: snapshot.size,
      updated,
      skipped,
      errors,
    };

    console.log('[migrateOutflowPeriodsTransactionSplits] Migration complete:', result);

    response.status(200).json(result);
  } catch (error) {
    console.error('[migrateOutflowPeriodsTransactionSplits] Migration failed:', error);
    response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      message: 'Migration failed',
    });
  }
});
