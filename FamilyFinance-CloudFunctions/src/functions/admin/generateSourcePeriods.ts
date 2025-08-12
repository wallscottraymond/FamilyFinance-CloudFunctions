import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  SourcePeriod, 
  PeriodType,
  UserRole
} from "../../types";
import { 
  authMiddleware, 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Generate source periods for budget application
 * Creates periods from January 1, 2023 through December 31, 2033
 * Generates monthly, weekly (Sunday start), and bi-monthly periods
 * Admin only function
 */
export const generateSourcePeriods = onRequest({
  region: "us-central1",
  memory: "512MiB",
  timeoutSeconds: 300, // 5 minutes for large batch operation
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "POST") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only POST requests are allowed")
      );
    }

    try {
      // Only admin users can generate source periods
      const authResult = await authMiddleware(request, UserRole.ADMIN);
      if (!authResult.success || !authResult.user) {
        return response.status(401).json(authResult.error);
      }

      const db = admin.firestore();
      const batch = db.batch();
      const sourcePeriodsRef = db.collection("source_periods");

      // Clear existing periods first
      const existingPeriods = await sourcePeriodsRef.get();
      existingPeriods.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      const periods: Omit<SourcePeriod, "createdAt" | "updatedAt">[] = [];
      const today = new Date();
      
      // Generate periods from 2023 to 2033
      for (let year = 2023; year <= 2033; year++) {
        // Generate monthly periods (UTC+0)
        for (let month = 1; month <= 12; month++) {
          const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
          const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // Last day of month
          
          const monthlyPeriod: Omit<SourcePeriod, "createdAt" | "updatedAt"> = {
            id: `${year}M${month.toString().padStart(2, '0')}`,
            periodId: `${year}M${month.toString().padStart(2, '0')}`,
            type: PeriodType.MONTHLY,
            startDate: admin.firestore.Timestamp.fromDate(startDate),
            endDate: admin.firestore.Timestamp.fromDate(endDate),
            year,
            index: parseInt(`${year}${month.toString().padStart(2, '0')}`),
            isCurrent: isCurrentPeriod(startDate, endDate, today, PeriodType.MONTHLY),
            metadata: {
              month,
              weekStartDay: 0
            }
          };

          periods.push(monthlyPeriod);

          // Generate bi-monthly periods (1st-15th, 16th-end) (UTC+0)
          const firstHalfEnd = new Date(Date.UTC(year, month - 1, 15, 23, 59, 59, 999));
          const secondHalfStart = new Date(Date.UTC(year, month - 1, 16, 0, 0, 0, 0));

          const biMonthlyFirstHalf: Omit<SourcePeriod, "createdAt" | "updatedAt"> = {
            id: `${year}BM${month.toString().padStart(2, '0')}A`,
            periodId: `${year}BM${month.toString().padStart(2, '0')}A`,
            type: PeriodType.BI_MONTHLY,
            startDate: admin.firestore.Timestamp.fromDate(startDate),
            endDate: admin.firestore.Timestamp.fromDate(firstHalfEnd),
            year,
            index: parseInt(`${year}${month.toString().padStart(2, '0')}1`),
            isCurrent: isCurrentPeriod(startDate, firstHalfEnd, today, PeriodType.BI_MONTHLY),
            metadata: {
              month,
              biMonthlyHalf: 1,
              weekStartDay: 0
            }
          };

          const biMonthlySecondHalf: Omit<SourcePeriod, "createdAt" | "updatedAt"> = {
            id: `${year}BM${month.toString().padStart(2, '0')}B`,
            periodId: `${year}BM${month.toString().padStart(2, '0')}B`,
            type: PeriodType.BI_MONTHLY,
            startDate: admin.firestore.Timestamp.fromDate(secondHalfStart),
            endDate: admin.firestore.Timestamp.fromDate(endDate),
            year,
            index: parseInt(`${year}${month.toString().padStart(2, '0')}2`),
            isCurrent: isCurrentPeriod(secondHalfStart, endDate, today, PeriodType.BI_MONTHLY),
            metadata: {
              month,
              biMonthlyHalf: 2,
              weekStartDay: 0
            }
          };

          periods.push(biMonthlyFirstHalf, biMonthlySecondHalf);
        }

        // Generate weekly periods (Sunday start) (UTC+0)
        const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
        const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
        
        // Find the first Sunday of the year or the first day if it's Sunday (UTC)
        let currentWeekStart = new Date(yearStart.getTime());
        while (currentWeekStart.getUTCDay() !== 0) {
          currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 1);
        }

        let weekNumber = 1;
        while (currentWeekStart.getUTCFullYear() === year || currentWeekStart < yearEnd) {
          const weekEnd = new Date(currentWeekStart.getTime());
          weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
          weekEnd.setUTCHours(23, 59, 59, 999);

          // Only include weeks that have some days in the current year (UTC)
          if (weekEnd.getUTCFullYear() >= year && currentWeekStart.getUTCFullYear() <= year) {
            // Get the ISO week number for better accuracy
            const isoWeekNumber = getISOWeekNumber(currentWeekStart);
            
            const weeklyPeriod: Omit<SourcePeriod, "createdAt" | "updatedAt"> = {
              id: `${year}W${weekNumber.toString().padStart(2, '0')}`,
              periodId: `${year}W${weekNumber.toString().padStart(2, '0')}`,
              type: PeriodType.WEEKLY,
              startDate: admin.firestore.Timestamp.fromDate(currentWeekStart),
              endDate: admin.firestore.Timestamp.fromDate(weekEnd),
              year,
              index: parseInt(`${year}${weekNumber.toString().padStart(2, '0')}`),
              isCurrent: isCurrentPeriod(currentWeekStart, weekEnd, today, PeriodType.WEEKLY),
              metadata: {
                weekNumber: isoWeekNumber,
                weekStartDay: 0
              }
            };

            periods.push(weeklyPeriod);
            weekNumber++;
          }

          currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() + 7);
        }
      }

      // Add all periods to batch with proper timestamps
      const now = admin.firestore.Timestamp.now();
      periods.forEach(period => {
        const docRef = sourcePeriodsRef.doc(period.id!);
        const fullPeriod: SourcePeriod = {
          ...period,
          createdAt: now,
          updatedAt: now
        };
        batch.set(docRef, fullPeriod);
      });

      // Commit the batch
      await batch.commit();

      const summary = {
        totalPeriods: periods.length,
        byType: {
          monthly: periods.filter(p => p.type === PeriodType.MONTHLY).length,
          weekly: periods.filter(p => p.type === PeriodType.WEEKLY).length,
          biMonthly: periods.filter(p => p.type === PeriodType.BI_MONTHLY).length
        },
        currentPeriods: periods.filter(p => p.isCurrent).length,
        yearRange: "2023-2033"
      };

      return response.status(200).json(createSuccessResponse(summary));

    } catch (error: any) {
      console.error("Error generating source periods:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to generate source periods")
      );
    }
  });
});

/**
 * Check if a period is the current period based on today's date
 */
function isCurrentPeriod(startDate: Date, endDate: Date, today: Date, type: PeriodType): boolean {
  return today >= startDate && today <= endDate;
}

/**
 * Get ISO week number for a given date
 * Returns the week number according to ISO 8601 standard
 */
function getISOWeekNumber(date: Date): number {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}