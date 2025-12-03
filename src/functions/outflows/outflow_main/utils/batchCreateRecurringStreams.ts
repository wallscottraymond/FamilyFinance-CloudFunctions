/**
 * Batch Create Recurring Streams Utility
 *
 * Handles bulk creation/updating of recurring inflows and outflows.
 * This is the final step in the recurring transaction pipeline.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../../../../index';

/**
 * Batch create or update inflow streams - FLAT STRUCTURE
 *
 * Checks if streams already exist and updates them, otherwise creates new ones.
 * Uses Plaid stream_id (stored in inflow.id) as the Firestore document ID.
 *
 * @param inflows - Array of FLAT inflow documents to create/update
 * @param userId - User ID for ownership verification
 * @returns Count of created and updated inflows
 */
export async function batchCreateInflowStreams(
  inflows: any[],
  userId: string
): Promise<{ created: number; updated: number; errors: string[] }> {
  console.log(`📦 [batchCreateInflowStreams] Processing ${inflows.length} FLAT inflow streams`);

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
        // Use stream_id (now in inflow.id) as the Firestore document ID
        const streamId = inflow.id;
        if (!streamId) {
          result.errors.push(`Inflow missing required 'id' field (stream_id)`);
          console.error(`❌ Inflow missing required 'id' field`);
          continue;
        }

        const docRef = db.collection('inflows').doc(streamId);
        const docSnapshot = await docRef.get();

        if (docSnapshot.exists) {
          // Update existing stream (FLAT structure - no nested objects)
          await docRef.update({
            // Descriptive fields
            description: inflow.description,
            merchantName: inflow.merchantName,
            userCustomName: inflow.userCustomName,

            // Financial data (flattened)
            averageAmount: inflow.averageAmount,
            lastAmount: inflow.lastAmount,
            currency: inflow.currency,
            unofficialCurrency: inflow.unofficialCurrency,

            // Temporal data
            frequency: inflow.frequency,
            lastDate: inflow.lastDate,
            predictedNextDate: inflow.predictedNextDate,

            // Categorization (flattened)
            plaidPrimaryCategory: inflow.plaidPrimaryCategory,
            plaidDetailedCategory: inflow.plaidDetailedCategory,
            plaidCategoryId: inflow.plaidCategoryId,
            internalPrimaryCategory: inflow.internalPrimaryCategory,
            internalDetailedCategory: inflow.internalDetailedCategory,

            // Income classification
            incomeType: inflow.incomeType,
            isRegularSalary: inflow.isRegularSalary,

            // Status & control (flattened)
            isActive: inflow.isActive,
            isUserModified: inflow.isUserModified,
            plaidStatus: inflow.plaidStatus,
            plaidConfidenceLevel: inflow.plaidConfidenceLevel,

            // Transaction references
            transactionIds: inflow.transactionIds,

            // User interaction
            tags: inflow.tags,
            rules: inflow.rules,

            // Audit trail
            updatedBy: userId,
            updatedAt: Timestamp.now(),
            lastSyncedAt: Timestamp.now()
          });

          result.updated++;
          console.log(`✅ Updated FLAT inflow stream: ${streamId}`);
        } else {
          // Create new stream with stream_id as document ID (FLAT structure)
          await docRef.set({
            ...inflow,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.created++;
          console.log(`✅ Created FLAT inflow stream: ${streamId}`);
        }
      } catch (error) {
        const errorMsg = `Failed to process inflow stream ${inflow.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
 * Batch create or update outflow streams - FLAT STRUCTURE
 *
 * Checks if streams already exist and updates them, otherwise creates new ones.
 * Uses Plaid stream_id (stored in outflow.id) as the Firestore document ID.
 *
 * @param outflows - Array of FLAT outflow documents to create/update
 * @param userId - User ID for ownership verification
 * @returns Count of created and updated outflows
 */
export async function batchCreateOutflowStreams(
  outflows: any[],
  userId: string
): Promise<{ created: number; updated: number; errors: string[] }> {
  console.log(`📦 [batchCreateOutflowStreams] Processing ${outflows.length} FLAT outflow streams`);

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
        // Use stream_id (now in outflow.id) as the Firestore document ID
        const streamId = outflow.id;
        if (!streamId) {
          result.errors.push(`Outflow missing required 'id' field (stream_id)`);
          console.error(`❌ Outflow missing required 'id' field`);
          continue;
        }

        const docRef = db.collection('outflows').doc(streamId);
        const docSnapshot = await docRef.get();

        if (docSnapshot.exists) {
          // Update existing stream (FLAT structure - no nested objects)
          await docRef.update({
            // Descriptive fields
            description: outflow.description,
            merchantName: outflow.merchantName,
            userCustomName: outflow.userCustomName,

            // Financial data (flattened)
            averageAmount: outflow.averageAmount,
            lastAmount: outflow.lastAmount,
            currency: outflow.currency,

            // Temporal data
            frequency: outflow.frequency,
            lastDate: outflow.lastDate,
            predictedNextDate: outflow.predictedNextDate,

            // Categorization (flattened)
            plaidPrimaryCategory: outflow.plaidPrimaryCategory,
            plaidDetailedCategory: outflow.plaidDetailedCategory,
            internalPrimaryCategory: outflow.internalPrimaryCategory,
            internalDetailedCategory: outflow.internalDetailedCategory,
            type: outflow.type,

            // Legacy fields
            expenseType: outflow.expenseType,
            isEssential: outflow.isEssential,

            // Status & control (flattened)
            isActive: outflow.isActive,
            isUserModified: outflow.isUserModified,
            plaidStatus: outflow.plaidStatus,

            // Transaction references
            transactionIds: outflow.transactionIds,

            // User interaction
            tags: outflow.tags,

            // Audit trail
            updatedBy: userId,
            updatedAt: Timestamp.now()
          });

          result.updated++;
          console.log(`✅ Updated FLAT outflow stream: ${streamId}`);
        } else {
          // Create new stream with stream_id as document ID (FLAT structure)
          await docRef.set({
            ...outflow,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now()
          });

          result.created++;
          console.log(`✅ Created FLAT outflow stream: ${streamId}`);
        }
      } catch (error) {
        const errorMsg = `Failed to process outflow stream ${outflow.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
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
