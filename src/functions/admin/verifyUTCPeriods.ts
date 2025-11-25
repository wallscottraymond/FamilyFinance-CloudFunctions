import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { 
  createErrorResponse, 
  createSuccessResponse
} from "../../utils/auth";
import { firebaseCors } from "../../middleware/cors";

/**
 * Verify if source periods are actually stored in UTC+0
 * This will show the raw timestamp values to confirm timezone
 */
export const verifyUTCPeriods = onRequest({
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
      const sourcePeriodsRef = db.collection("source_periods");

      // Get a few sample periods to check
      const sampleQuery = await sourcePeriodsRef
        .where("year", "==", 2025)
        .where("type", "==", "monthly")
        .limit(3)
        .get();

      if (sampleQuery.empty) {
        return response.status(404).json(
          createErrorResponse("no-periods", "No periods found to verify")
        );
      }

      const verificationResults = sampleQuery.docs.map(doc => {
        const data = doc.data();
        const startDate = data.startDate.toDate();
        const endDate = data.endDate.toDate();
        
        return {
          id: data.id,
          type: data.type,
          year: data.year,
          rawTimestamps: {
            startDate: {
              firestoreTimestamp: data.startDate.seconds,
              jsDate: startDate.toISOString(),
              utcString: startDate.toUTCString(),
              localString: startDate.toString(),
              utcHours: startDate.getUTCHours(),
              utcMinutes: startDate.getUTCMinutes(),
              timezone: startDate.getTimezoneOffset()
            },
            endDate: {
              firestoreTimestamp: data.endDate.seconds,
              jsDate: endDate.toISOString(), 
              utcString: endDate.toUTCString(),
              localString: endDate.toString(),
              utcHours: endDate.getUTCHours(),
              utcMinutes: endDate.getUTCMinutes(),
              timezone: endDate.getTimezoneOffset()
            }
          },
          isCorrectUTC: {
            startDateIsUTCMidnight: startDate.getUTCHours() === 0 && startDate.getUTCMinutes() === 0,
            endDateIsUTCEndOfDay: endDate.getUTCHours() === 23 && endDate.getUTCMinutes() === 59
          }
        };
      });

      // Also create a test UTC date to compare
      const testUTCDate = new Date(Date.UTC(2025, 2, 1, 0, 0, 0, 0)); // March 1, 2025 UTC
      
      return response.status(200).json(createSuccessResponse({
        message: "Period timezone verification results",
        serverTime: {
          now: new Date().toISOString(),
          utcNow: new Date().toUTCString(),
          timezoneOffset: new Date().getTimezoneOffset()
        },
        testUTCDate: {
          jsDate: testUTCDate.toISOString(),
          utcString: testUTCDate.toUTCString(),
          utcHours: testUTCDate.getUTCHours(),
          shouldBeZero: testUTCDate.getUTCHours() === 0
        },
        periods: verificationResults,
        analysis: {
          totalPeriodsChecked: verificationResults.length,
          correctUTCCount: verificationResults.filter(p => p.isCorrectUTC.startDateIsUTCMidnight).length,
          recommendation: verificationResults.every(p => p.isCorrectUTC.startDateIsUTCMidnight) 
            ? "Periods are correctly stored in UTC+0" 
            : "Periods need to be regenerated with proper UTC+0 timezone"
        }
      }));

    } catch (error: any) {
      console.error("Error verifying periods:", error);
      return response.status(500).json(
        createErrorResponse("internal-error", "Failed to verify period timezones")
      );
    }
  });
});