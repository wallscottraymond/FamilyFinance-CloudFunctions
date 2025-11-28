"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestUserPeriodSummaries = void 0;
const https_1 = require("firebase-functions/v2/https");
const preCreateUserPeriodSummaries_1 = require("../summaries/orchestration/preCreateUserPeriodSummaries");
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
exports.createTestUserPeriodSummaries = (0, https_1.onCall)({
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 120,
}, async (request) => {
    var _a;
    console.log("");
    console.log("🧪 TEST FUNCTION: createTestUserPeriodSummaries");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    try {
        // Get userId from request data or use authenticated user
        const data = request.data;
        const userId = data.userId || ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid);
        if (!userId) {
            console.error("❌ No userId provided and user not authenticated");
            throw new https_1.HttpsError("invalid-argument", "No userId provided and user not authenticated");
        }
        console.log(`📋 User ID: ${userId}`);
        // Verify user exists
        const userDoc = await db.collection("users").doc(userId).get();
        if (!userDoc.exists) {
            console.error(`❌ User not found: ${userId}`);
            throw new https_1.HttpsError("not-found", `User not found: ${userId}. Make sure the user exists in the users collection.`);
        }
        const userData = userDoc.data();
        console.log(`✓ User found: ${(userData === null || userData === void 0 ? void 0 : userData.email) || "No email"}`);
        // Count existing summaries before
        const existingSummariesQuery = await db
            .collection("user_summaries")
            .where("userId", "==", userId)
            .get();
        const existingCount = existingSummariesQuery.size;
        console.log(`📊 Existing summaries: ${existingCount}`);
        if (existingCount > 0) {
            console.log(`⚠️  Warning: User already has ${existingCount} summaries. This will update them.`);
        }
        console.log("");
        console.log("🚀 Starting period summary pre-creation...");
        console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        const startTime = Date.now();
        // Call the exact same function as onUserCreate
        await (0, preCreateUserPeriodSummaries_1.preCreateUserPeriodSummaries)(userId);
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
            userEmail: (userData === null || userData === void 0 ? void 0 : userData.email) || null,
            duration: `${duration}ms`,
            summaries: {
                before: existingCount,
                after: newCount,
                created: created,
            },
            message: `Successfully ${created > 0 ? "created" : "updated"} period summaries for user`,
        };
    }
    catch (error) {
        console.error("");
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("❌ TEST FAILED");
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("Error:", error);
        console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        console.error("");
        throw new https_1.HttpsError("internal", error instanceof Error ? error.message : String(error));
    }
});
//# sourceMappingURL=createTestUserPeriodSummaries.js.map