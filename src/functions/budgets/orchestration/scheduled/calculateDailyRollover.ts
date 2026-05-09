/**
 * Scheduled Daily Rollover Calculation
 *
 * This Cloud Function runs daily to ensure rollover amounts are calculated
 * for budget periods that just became current. This catches periods that
 * became active without any spending activity triggering the recalculation.
 *
 * Runs daily at 3:00 AM UTC (after period extension at 2:00 AM)
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { recalculateRolloverForCurrentPeriods } from '../../utils/rolloverChainCalculation';

/**
 * Scheduled function to calculate rollover for current periods
 * Runs daily at 3:00 AM UTC
 */
export const calculateDailyRollover = onSchedule({
  schedule: '0 3 * * *', // Cron: 3:00 AM UTC every day
  timeZone: 'UTC',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (event) => {
  console.log('');
  console.log('🔄 ════════════════════════════════════════════════════════════');
  console.log('🔄 STARTING DAILY ROLLOVER CALCULATION');
  console.log('🔄 ════════════════════════════════════════════════════════════');
  console.log(`🔄 Execution time: ${new Date().toISOString()}`);
  console.log('');

  const db = admin.firestore();

  try {
    const result = await recalculateRolloverForCurrentPeriods(db);

    console.log('');
    console.log('🔄 ════════════════════════════════════════════════════════════');
    console.log('🔄 DAILY ROLLOVER CALCULATION COMPLETE');
    console.log('🔄 ════════════════════════════════════════════════════════════');
    console.log(`🔄 Budgets processed: ${result.budgetsProcessed}`);
    console.log(`🔄 Periods updated: ${result.periodsUpdated}`);

    if (result.errors.length > 0) {
      console.warn(`🔄 Errors encountered: ${result.errors.length}`);
      result.errors.forEach((error, index) => {
        console.warn(`   ${index + 1}. ${error}`);
      });
    }

    console.log('');

  } catch (error) {
    console.error('');
    console.error('🔄 ❌ FATAL ERROR in daily rollover calculation:', error);
    console.error('');
    throw error; // Re-throw to mark the function execution as failed
  }
});
