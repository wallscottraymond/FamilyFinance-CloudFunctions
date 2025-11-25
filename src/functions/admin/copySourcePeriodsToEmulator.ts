import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Copy source_periods collection to emulator
 *
 * This function fetches all source_periods from production Firestore
 * and returns them as JSON that can be imported to the emulator.
 *
 * Usage from emulator:
 * Call this function, then write the results to emulator Firestore
 */
export const exportSourcePeriods = onCall(async (request) => {
  // Optional: Add authentication check
  // if (!request.auth) {
  //   throw new HttpsError("unauthenticated", "Must be authenticated");
  // }

  try {
    console.log("Fetching source_periods from Firestore...");

    const db = admin.firestore();
    const snapshot = await db.collection("source_periods").get();

    console.log(`Found ${snapshot.size} source_periods documents`);

    const documents: any[] = [];
    snapshot.forEach(doc => {
      documents.push({
        id: doc.id,
        data: doc.data()
      });
    });

    return {
      success: true,
      count: documents.length,
      documents
    };

  } catch (error) {
    console.error("Error exporting source_periods:", error);
    throw new HttpsError("internal", "Failed to export source_periods");
  }
});
