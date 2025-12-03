/**
 * Batch create outflow periods using Firestore batch operations
 */

import * as admin from 'firebase-admin';
import { OutflowPeriod } from '../../../../types';

/**
 * Efficiently create multiple outflow_periods using Firestore batch operations
 *
 * @param db - Firestore instance
 * @param outflowPeriods - Array of outflow periods to create
 */
export async function batchCreateOutflowPeriods(
  db: admin.firestore.Firestore,
  outflowPeriods: OutflowPeriod[]
): Promise<void> {
  const BATCH_SIZE = 500; // Firestore batch limit

  for (let i = 0; i < outflowPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = outflowPeriods.slice(i, i + BATCH_SIZE);

    batchPeriods.forEach((outflowPeriod) => {
      const docRef = db.collection('outflow_periods').doc(outflowPeriod.id!);
      batch.set(docRef, outflowPeriod);
    });

    await batch.commit();
    const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(outflowPeriods.length / BATCH_SIZE);
    console.log(`[batchCreateOutflowPeriods] Created batch ${batchNumber}/${totalBatches} (${batchPeriods.length} periods)`);
  }
}
