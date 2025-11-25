import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import * as admin from "firebase-admin";
import { SourcePeriod, PeriodType } from "../../types";

/**
 * Scheduled function that runs daily at midnight UTC to update the isCurrent flag
 * for source periods based on the current date.
 * 
 * This function:
 * 1. Sets ALL periods to isCurrent: false first
 * 2. Finds and sets current periods to isCurrent: true for each type:
 *    - Current monthly period (contains today's date)
 *    - Current weekly period (contains today's date)
 *    - Current bi-monthly period (contains today's date)
 * 3. Uses batch writes for efficient operations
 * 4. Logs which periods were updated
 */
export const updateCurrentPeriods = onSchedule({
  schedule: "0 0 * * *", // Daily at midnight UTC (00:00)
  timeZone: "UTC",
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 300 // 5 minutes timeout
}, async (event) => {
  const db = admin.firestore();
  const today = admin.firestore.Timestamp.now();
  
  logger.info("Starting updateCurrentPeriods function", {
    timestamp: today.toDate().toISOString(),
    schedule: event.scheduleTime
  });

  try {
    // Step 1: Get all source periods
    const sourcePeriodsRef = db.collection("source_periods");
    const allPeriodsSnapshot = await sourcePeriodsRef.get();
    
    if (allPeriodsSnapshot.empty) {
      logger.warn("No source periods found in the database");
      return;
    }

    logger.info(`Found ${allPeriodsSnapshot.size} source periods to process`);

    // Step 2: Set up batch processing constants
    const maxBatchSize = 500; // Firestore batch limit

    // Track periods that will be marked as current
    const currentPeriods: { [key in PeriodType]: SourcePeriod | null } = {
      [PeriodType.MONTHLY]: null,
      [PeriodType.WEEKLY]: null,
      [PeriodType.BI_MONTHLY]: null
    };

    // Step 3: Process all periods and find current ones
    const allPeriods: SourcePeriod[] = [];
    
    allPeriodsSnapshot.forEach((doc) => {
      const period = { id: doc.id, ...doc.data() } as SourcePeriod;
      allPeriods.push(period);

      // Check if this period contains today's date
      const isCurrentPeriod = today.toDate() >= period.startDate.toDate() && 
                             today.toDate() <= period.endDate.toDate();

      if (isCurrentPeriod) {
        currentPeriods[period.type] = period;
      }
    });

    // Step 4: Determine which periods need updates
    const updatesToFalse: SourcePeriod[] = [];
    const updatesToTrue: SourcePeriod[] = [];
    const updatedPeriods: string[] = [];

    for (const period of allPeriods) {
      const shouldBeCurrent = Object.values(currentPeriods).some(cp => cp?.id === period.id);
      
      if (period.isCurrent && !shouldBeCurrent) {
        // Currently true but should be false
        updatesToFalse.push(period);
      } else if (!period.isCurrent && shouldBeCurrent) {
        // Currently false but should be true  
        updatesToTrue.push(period);
        const periodType = Object.keys(currentPeriods).find(
          key => currentPeriods[key as PeriodType]?.id === period.id
        );
        updatedPeriods.push(`${periodType}: ${period.periodId}`);
      }
    }

    // Step 5: Apply all updates in efficient batches
    const allUpdates = [
      ...updatesToFalse.map(p => ({ period: p, isCurrent: false })),
      ...updatesToTrue.map(p => ({ period: p, isCurrent: true }))
    ];

    if (allUpdates.length === 0) {
      logger.info("No period updates needed - all periods already have correct isCurrent status");
      return;
    }

    // Process updates in batches
    for (let i = 0; i < allUpdates.length; i += maxBatchSize) {
      const batchUpdates = allUpdates.slice(i, i + maxBatchSize);
      const updateBatch = db.batch();

      batchUpdates.forEach(({ period, isCurrent }) => {
        updateBatch.update(sourcePeriodsRef.doc(period.id!), { 
          isCurrent,
          updatedAt: today
        });
      });

      await updateBatch.commit();
      logger.info(`Committed batch ${Math.floor(i / maxBatchSize) + 1}: ${batchUpdates.length} updates`);
    }

    // Log details of current periods
    for (const [periodType, currentPeriod] of Object.entries(currentPeriods)) {
      if (currentPeriod) {
        logger.info(`Current ${periodType} period`, {
          periodId: currentPeriod.periodId,
          startDate: currentPeriod.startDate.toDate().toISOString(),
          endDate: currentPeriod.endDate.toDate().toISOString(),
          year: currentPeriod.year,
          index: currentPeriod.index
        });
      } else {
        logger.warn(`No current ${periodType} period found for today`, {
          today: today.toDate().toISOString()
        });
      }
    }

    // Step 6: Log summary
    const summary = {
      totalPeriodsProcessed: allPeriods.length,
      totalUpdatesApplied: allUpdates.length,
      periodsSetToFalse: updatesToFalse.length,
      periodsSetToTrue: updatesToTrue.length,
      currentPeriods: updatedPeriods,
      executionTime: Date.now() - today.toMillis(),
      timestamp: today.toDate().toISOString()
    };

    logger.info("updateCurrentPeriods function completed successfully", summary);

  } catch (error) {
    logger.error("Error in updateCurrentPeriods function", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: today.toDate().toISOString()
    });
    
    // Re-throw to ensure the function is marked as failed for retry
    throw error;
  }
});