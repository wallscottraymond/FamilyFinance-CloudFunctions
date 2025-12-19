/**
 * Regenerate All Outflow Summaries with Occurrence Tracking Data
 *
 * This dev function recalculates all outflow summary documents to include
 * the new occurrence tracking fields that were added in the latest update.
 *
 * USE CASE: After deploying occurrence tracking changes, run this function
 * to populate existing summary documents with occurrence data.
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { PeriodType } from '../../../../types';
import { batchUpdateSummary } from '../utils/batchUpdateSummary';

/**
 * Regenerate all outflow summaries for a user
 *
 * This function:
 * 1. Finds all unique (ownerId, periodType, sourcePeriodId) combinations
 * 2. Recalculates each period group with the new occurrence tracking fields
 * 3. Updates the summary documents
 *
 * @param userId - User ID to regenerate summaries for
 */
export const regenerateAllOutflowSummaries = onRequest(
  {
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async (request, response) => {
    try {
      const { userId } = request.query;

      if (!userId || typeof userId !== 'string') {
        response.status(400).json({
          success: false,
          error: 'userId query parameter is required'
        });
        return;
      }

      console.log('');
      console.log('════════════════════════════════════════════════════════════');
      console.log('🔄 REGENERATE ALL OUTFLOW SUMMARIES');
      console.log('════════════════════════════════════════════════════════════');
      console.log(`User ID: ${userId}`);
      console.log('');

      const db = admin.firestore();

      // Step 1: Get all unique (periodType, sourcePeriodId) combinations for this user
      const outflowPeriodsSnapshot = await db.collection('outflow_periods')
        .where('ownerId', '==', userId)
        .where('isActive', '==', true)
        .get();

      console.log(`📊 Found ${outflowPeriodsSnapshot.size} active outflow periods`);

      // Build set of unique combinations
      const periodCombinations = new Set<string>();

      outflowPeriodsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const key = `${data.periodType}:${data.sourcePeriodId}`;
        periodCombinations.add(key);
      });

      console.log(`📋 Found ${periodCombinations.size} unique period combinations to recalculate`);
      console.log('');

      // Step 2: Recalculate each combination
      let recalculatedCount = 0;
      let errorCount = 0;
      const errors: string[] = [];

      for (const combination of periodCombinations) {
        const [periodType, sourcePeriodId] = combination.split(':');

        try {
          console.log(`🔄 Recalculating: ${sourcePeriodId} (${periodType})`);

          // Get summary ID
          const summaryId = `${userId}_outflowsummary_${periodType.toLowerCase()}`;

          // Call batchUpdateSummary with correct structure
          await batchUpdateSummary({
            summaryId,
            operations: [
              {
                type: 'recalculate',
                data: {
                  sourcePeriodId,
                  ownerId: userId,
                  ownerType: 'user',
                  periodType: periodType as PeriodType
                }
              }
            ]
          });

          recalculatedCount++;
          console.log(`   ✅ Success`);

        } catch (error) {
          errorCount++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          errors.push(`${sourcePeriodId} (${periodType}): ${errorMsg}`);
          console.error(`   ❌ Error: ${errorMsg}`);
        }
      }

      console.log('');
      console.log('════════════════════════════════════════════════════════════');
      console.log('📊 REGENERATION SUMMARY');
      console.log('════════════════════════════════════════════════════════════');
      console.log(`Total Combinations: ${periodCombinations.size}`);
      console.log(`✅ Successfully Recalculated: ${recalculatedCount}`);
      console.log(`❌ Errors: ${errorCount}`);
      console.log('');

      if (errors.length > 0) {
        console.log('Errors:');
        errors.forEach(err => console.log(`  - ${err}`));
        console.log('');
      }

      response.status(200).json({
        success: true,
        userId,
        totalCombinations: periodCombinations.size,
        recalculatedCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined
      });

    } catch (error) {
      console.error('');
      console.error('❌ FATAL ERROR:', error);
      console.error('');

      response.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);
