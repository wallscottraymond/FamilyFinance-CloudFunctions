/**
 * Admin Function: Extend Outflow Periods
 *
 * Extends existing outflow periods by generating additional periods forward in time.
 * This is useful when existing outflows need periods extended beyond their current range.
 *
 * Usage:
 * POST https://us-central1-{project}.cloudfunctions.net/extendOutflowPeriods
 * Body: {
 *   "outflowId": "outflow_id_here",  // Optional: specific outflow
 *   "userId": "user_id_here",        // Optional: all outflows for user
 *   "monthsForward": 15              // Optional: default 15
 * }
 */

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { RecurringOutflow } from '../../../../types';
import { createOutflowPeriodsFromSource } from '../crud/createOutflowPeriods';

export const extendOutflowPeriods = onRequest({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 540,
}, async (req, res) => {
  try {
    const { outflowId, userId, monthsForward = 15 } = req.body;

    if (!outflowId && !userId) {
      res.status(400).json({
        success: false,
        message: 'Either outflowId or userId must be provided'
      });
      return;
    }

    const db = admin.firestore();
    let outflowsToExtend: Array<{ id: string; data: RecurringOutflow }> = [];

    // Get outflows to extend
    if (outflowId) {
      const outflowDoc = await db.collection('outflows').doc(outflowId).get();
      if (!outflowDoc.exists) {
        res.status(404).json({
          success: false,
          message: `Outflow ${outflowId} not found`
        });
        return;
      }
      outflowsToExtend.push({
        id: outflowDoc.id,
        data: outflowDoc.data() as RecurringOutflow
      });
    } else if (userId) {
      const outflowsSnapshot = await db.collection('outflows')
        .where('userId', '==', userId)
        .where('isActive', '==', true)
        .get();

      outflowsToExtend = outflowsSnapshot.docs.map(doc => ({
        id: doc.id,
        data: doc.data() as RecurringOutflow
      }));
    }

    console.log(`[extendOutflowPeriods] Extending ${outflowsToExtend.length} outflows`);

    const results = {
      success: true,
      outflowsProcessed: 0,
      periodsCreated: 0,
      errors: [] as string[]
    };

    for (const outflow of outflowsToExtend) {
      try {
        // Find the latest existing period for this outflow
        const existingPeriodsSnapshot = await db.collection('outflow_periods')
          .where('outflowId', '==', outflow.id)
          .orderBy('periodEndDate', 'desc')
          .limit(1)
          .get();

        let startDate: Date;

        if (existingPeriodsSnapshot.empty) {
          // No existing periods, start from firstDate
          console.log(`[extendOutflowPeriods] No existing periods for ${outflow.id}, starting from firstDate`);
          startDate = outflow.data.firstDate.toDate();
        } else {
          // Start from the day after the latest period ends
          const latestPeriod = existingPeriodsSnapshot.docs[0].data();
          startDate = latestPeriod.periodEndDate.toDate();
          startDate.setDate(startDate.getDate() + 1); // Start from next day
          console.log(`[extendOutflowPeriods] Latest period for ${outflow.id} ends ${latestPeriod.periodEndDate.toDate().toISOString()}`);
        }

        // Calculate end date (N months forward from now)
        const now = new Date();
        const endDate = new Date(now);
        endDate.setMonth(endDate.getMonth() + monthsForward);

        console.log(`[extendOutflowPeriods] Generating periods for ${outflow.id} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Only create periods if startDate is before endDate
        if (startDate >= endDate) {
          console.log(`[extendOutflowPeriods] Outflow ${outflow.id} already has periods through ${startDate.toISOString()}, skipping`);
          continue;
        }

        // Create new periods
        const result = await createOutflowPeriodsFromSource(
          db,
          outflow.id,
          outflow.data,
          startDate,
          endDate
        );

        results.outflowsProcessed++;
        results.periodsCreated += result.periodsCreated;

        console.log(`[extendOutflowPeriods] Created ${result.periodsCreated} periods for outflow ${outflow.id}`);

      } catch (error) {
        const errorMsg = `Failed to extend outflow ${outflow.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        results.errors.push(errorMsg);
        console.error(`[extendOutflowPeriods] ${errorMsg}`);
      }
    }

    res.json({
      success: true,
      outflowsProcessed: results.outflowsProcessed,
      periodsCreated: results.periodsCreated,
      errors: results.errors,
      message: `Extended ${results.outflowsProcessed} outflows, created ${results.periodsCreated} new periods`
    });

  } catch (error) {
    console.error('[extendOutflowPeriods] Error:', error);
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});
