import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Test function to check current period detection logic
 * Shows what today's date looks like server-side vs what periods are marked as current
 */
export const testCurrentPeriods = onRequest({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request, response) => {
  return firebaseCors(request, response, async () => {
    if (request.method !== "GET") {
      return response.status(405).json(
        createErrorResponse("method-not-allowed", "Only GET requests are allowed")
      );
    }

    try {
      const db = admin.firestore();
      const today = admin.firestore.Timestamp.now();
      const todayDate = today.toDate();
      
      console.log(`Server time check: ${todayDate.toISOString()}`);

      // Get all current periods
      const currentPeriodsQuery = await db.collection('source_periods')
        .where('isCurrent', '==', true)
        .get();

      const currentPeriods = currentPeriodsQuery.docs.map(doc => {
        const data = doc.data();
        const startDate = data.startDate.toDate();
        const endDate = data.endDate.toDate();
        
        return {
          id: data.id,
          type: data.type,
          index: data.index,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          isInRange: todayDate >= startDate && todayDate <= endDate,
          daysFromStart: Math.floor((todayDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)),
          daysToEnd: Math.floor((endDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24))
        };
      });

      // Check what should be current based on today's date
      const allPeriodsQuery = await db.collection('source_periods')
        .get();
      
      const shouldBeCurrentPeriods: Array<{
        id: string;
        type: string;
        index: number;
        startDate: string;
        endDate: string;
        isMarkedCurrent: boolean;
      }> = [];
      
      allPeriodsQuery.docs.forEach(doc => {
        const data = doc.data();
        const startDate = data.startDate.toDate();
        const endDate = data.endDate.toDate();
        
        if (todayDate >= startDate && todayDate <= endDate) {
          shouldBeCurrentPeriods.push({
            id: data.id,
            type: data.type,
            index: data.index,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            isMarkedCurrent: data.isCurrent === true
          });
        }
      });

      return response.status(200).json(createSuccessResponse({
        serverInfo: {
          serverTime: todayDate.toISOString(),
          serverTimeUTC: todayDate.toUTCString(),
          serverTimezone: todayDate.getTimezoneOffset(),
          timestampSeconds: today.seconds
        },
        currentPeriodsMarked: {
          count: currentPeriods.length,
          periods: currentPeriods
        },
        shouldBeCurrentPeriods: {
          count: shouldBeCurrentPeriods.length,
          periods: shouldBeCurrentPeriods
        },
        analysis: {
          correctlyMarked: shouldBeCurrentPeriods.filter(p => p.isMarkedCurrent).length,
          incorrectlyMarked: currentPeriods.filter(p => !p.isInRange).length,
          needsUpdate: shouldBeCurrentPeriods.length !== currentPeriods.length || 
                       shouldBeCurrentPeriods.some(p => !p.isMarkedCurrent)
        }
      }));

    } catch (error: any) {
      console.error("Error testing current periods:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to test current periods")
      );
    }
  });
});