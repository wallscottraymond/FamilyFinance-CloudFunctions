/**
 * Batch Create Recurring Streams Utility
 *
 * Handles bulk creation/updating of recurring inflows and outflows.
 * This is the final step in the recurring transaction pipeline.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../index';

/**
 * Batch create or update inflow streams
 *
 * Checks if streams already exist and updates them, otherwise creates new ones.
 *
 * @param inflows - Array of inflow documents to create/update
 * @param userId - User ID for ownership verification
 * @returns Count of created and updated inflows
 */
export async function batchCreateInflowStreams(
  inflows: any[],
  userId: string
): Promise<{ created: number; updated: number; errors: string[] }> {
  console.log(`📦 [batchCreateInflowStreams] Processing ${inflows.length} inflow streams`);

  const result = {
    created: 0,
    updated: 0,
    errors: [] as string[]
  };

  if (inflows.length === 0) {
    console.log(`⏭️ [batchCreateInflowStreams] No inflows to process`);
    return result;
  }

  try {
    for (const inflow of inflows) {
      try {
        // Check if stream already exists
        const existingQuery = await db.collection('inflows')
          .where('streamId', '==', inflow.streamId)
          .where('userId', '==', userId)
          .limit(1)
          .get();

        if (!existingQuery.empty) {
          // Update existing stream
          const existingDoc = existingQuery.docs[0];
          await existingDoc.ref.update({
            description: inflow.description,
            merchantName: inflow.merchantName,
            averageAmount: inflow.averageAmount,
            lastAmount: inflow.lastAmount,
            frequency: inflow.frequency,
            lastDate: inflow.lastDate,
            predictedNextDate: inflow.predictedNextDate,
            status: inflow.status,
            isActive: inflow.isActive,
            'metadata.lastSyncedAt': Timestamp.now(),
            'metadata.updatedAt': Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.updated++;
          console.log(`✅ Updated inflow stream: ${inflow.streamId}`);
        } else {
          // Create new stream
          const docRef = db.collection('inflows').doc();
          await docRef.set({
            ...inflow,
            id: docRef.id,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.created++;
          console.log(`✅ Created inflow stream: ${inflow.streamId}`);
        }
      } catch (error) {
        const errorMsg = `Failed to process inflow stream ${inflow.streamId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    console.log(`✅ [batchCreateInflowStreams] Completed: ${result.created} created, ${result.updated} updated`);
    return result;

  } catch (error) {
    console.error('[batchCreateInflowStreams] Error in batch creation:', error);
    throw error;
  }
}

/**
 * Batch create or update outflow streams
 *
 * Checks if streams already exist and updates them, otherwise creates new ones.
 *
 * @param outflows - Array of outflow documents to create/update
 * @param userId - User ID for ownership verification
 * @returns Count of created and updated outflows
 */
export async function batchCreateOutflowStreams(
  outflows: any[],
  userId: string
): Promise<{ created: number; updated: number; errors: string[] }> {
  console.log(`📦 [batchCreateOutflowStreams] Processing ${outflows.length} outflow streams`);

  const result = {
    created: 0,
    updated: 0,
    errors: [] as string[]
  };

  if (outflows.length === 0) {
    console.log(`⏭️ [batchCreateOutflowStreams] No outflows to process`);
    return result;
  }

  try {
    for (const outflow of outflows) {
      try {
        // Check if stream already exists
        const existingQuery = await db.collection('outflows')
          .where('streamId', '==', outflow.streamId)
          .where('userId', '==', userId)
          .limit(1)
          .get();

        if (!existingQuery.empty) {
          // Update existing stream
          const existingDoc = existingQuery.docs[0];
          await existingDoc.ref.update({
            description: outflow.description,
            merchantName: outflow.merchantName,
            averageAmount: outflow.averageAmount,
            lastAmount: outflow.lastAmount,
            frequency: outflow.frequency,
            lastDate: outflow.lastDate,
            predictedNextDate: outflow.predictedNextDate,
            status: outflow.status,
            isActive: outflow.isActive,
            'metadata.lastSyncedAt': Timestamp.now(),
            'metadata.updatedAt': Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.updated++;
          console.log(`✅ Updated outflow stream: ${outflow.streamId}`);
        } else {
          // Create new stream
          const docRef = db.collection('outflows').doc();
          await docRef.set({
            ...outflow,
            id: docRef.id,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.created++;
          console.log(`✅ Created outflow stream: ${outflow.streamId}`);
        }
      } catch (error) {
        const errorMsg = `Failed to process outflow stream ${outflow.streamId}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        result.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    console.log(`✅ [batchCreateOutflowStreams] Completed: ${result.created} created, ${result.updated} updated`);
    return result;

  } catch (error) {
    console.error('[batchCreateOutflowStreams] Error in batch creation:', error);
    throw error;
  }
}
