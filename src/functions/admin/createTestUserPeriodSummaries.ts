/**
 * Admin Function: Create Test User Period Summaries
 *
 * This function allows testing the period summary pre-creation logic
 * without having to create a new user each time. It follows the exact
 * same flow as the onUserCreate trigger.
 *
 * Usage from mobile app:
 * - Button in Dev Tools screen
 * - Automatically uses current user's ID
 *
 * Usage from curl (optional):
 * curl -X POST http://127.0.0.1:5001/family-budget-app-cb59b/us-central1/createTestUserPeriodSummaries \
 *   -H "Content-Type: application/json" \
 *   -d '{"userId": "YOUR_USER_ID"}'
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { preCreateUserPeriodSummaries } from "../summaries/orchestration/preCreateUserPeriodSummaries";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore();

interface CreateTestUserPeriodSummariesRequest {
  userId?: string; // Optional - defaults to authenticated user
}

export const createTestUserPeriodSummaries = onCall(
  {
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
  },
  async (request) => {
    console.log("");
    console.log("🧪 TEST FUNCTION: createTestUserPeriodSummaries");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    try {
      // Get userId from request data or use authenticated user
      const data = request.data as CreateTestUserPeriodSummariesRequest;
      const userId = data.userId || request.auth?.uid;

      if (!userId) {
        console.error("❌ No userId provided and user not authenticated");
        throw new HttpsError(
          "invalid-argument",
          "No userId provided and user not authenticated"
        );
      }

      console.log(`📋 User ID: ${userId}`);

      // Verify user exists
      const userDoc = await db.collection("users").doc(userId).get();

      if (!userDoc.exists) {
        console.error(`❌ User not found: ${userId}`);
        throw new HttpsError(
          "not-found",
          `User not found: ${userId}. Make sure the user exists in the users collection.`
        );
      }

      const userData = userDoc.data();
      console.log(`✓ User found: ${userData?.email || "No email"}`);

      // Count existing summaries before
      const existingSummariesQuery = await db
        .collection("user_summaries")
        .where("userId", "==", userId)
        .get();

      const existingCount = existingSummariesQuery.size;
      console.log(`📊 Existing summaries: ${existingCount}`);

      if (existingCount > 0) {
        console.log(
          `⚠️  Warning: User already has ${existingCount} summaries. This will update them.`
        );
      }

      console.log("");
      console.log("🚀 Starting period summary pre-creation...");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      const startTime = Date.now();

      // Call the exact same function as onUserCreate
      await preCreateUserPeriodSummaries(userId);

      const duration = Date.now() - startTime;

      // Count summaries after
      const newSummariesQuery = await db
        .collection("user_summaries")
        .where("userId", "==", userId)
        .get();

      const newCount = newSummariesQuery.size;
      const created = newCount - existingCount;

      console.log("");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("✅ TEST COMPLETE");
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log(`⏱️  Duration: ${duration}ms`);
      console.log(`📊 Summary Count: ${newCount} total (${created > 0 ? `+${created}` : created} created/updated)`);
      console.log("");

      // Return success response
      return {
        success: true,
        userId,
        userEmail: userData?.email || null,
        duration: `${duration}ms`,
        summaries: {
          before: existingCount,
          after: newCount,
          created: created,
        },
        message: `Successfully ${created > 0 ? "created" : "updated"} period summaries for user`,
      };
    } catch (error) {
      console.error("");
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error("❌ TEST FAILED");
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error("Error:", error);
      console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.error("");

      throw new HttpsError(
        "internal",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
);
