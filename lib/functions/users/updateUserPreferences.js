"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateUserPreferences = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const db = (0, firestore_1.getFirestore)();
/**
 * Deep merge two objects, with source values overwriting target values
 */
function deepMerge(target, source) {
    const result = Object.assign({}, target);
    for (const key of Object.keys(source)) {
        const sourceValue = source[key];
        const targetValue = target[key];
        if (sourceValue !== null &&
            typeof sourceValue === "object" &&
            !Array.isArray(sourceValue) &&
            targetValue !== null &&
            typeof targetValue === "object" &&
            !Array.isArray(targetValue)) {
            // Recursively merge nested objects
            result[key] = deepMerge(targetValue, sourceValue);
        }
        else if (sourceValue !== undefined) {
            // Override with source value
            result[key] = sourceValue;
        }
    }
    return result;
}
/**
 * Callable API: Update User Preferences
 *
 * Updates user preferences with deep merge support. This function bypasses
 * the strict security rules that require full document validation, allowing
 * partial preference updates from the mobile app.
 *
 * Request Parameters:
 * - preferences: Partial<UserPreferences> - The preferences to update (deep merged)
 *
 * Example usage from mobile:
 * ```typescript
 * const updatePrefs = httpsCallable(functions, 'updateUserPreferences');
 * await updatePrefs({
 *   preferences: {
 *     display: {
 *       periodView: {
 *         defaultPeriodType: 'weekly',
 *         incomeTileSize: 'medium'
 *       }
 *     }
 *   }
 * });
 * ```
 *
 * Returns:
 * - success: boolean
 * - preferences: UserPreferences (the updated preferences)
 */
exports.updateUserPreferences = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    // Allow unauthenticated HTTP invocations at Cloud Run level
    // Firebase Auth token is validated inside the function via request.auth
    invoker: "public",
}, async (request) => {
    // Check authentication
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated to update preferences");
    }
    const userId = request.auth.uid;
    const { preferences } = request.data || {};
    if (!preferences || typeof preferences !== "object") {
        throw new https_1.HttpsError("invalid-argument", "preferences object is required");
    }
    console.log(`[updateUserPreferences] Updating preferences for user ${userId}`);
    try {
        const userRef = db.collection("users").doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists) {
            throw new https_1.HttpsError("not-found", "User document not found");
        }
        const userData = userDoc.data();
        const currentPreferences = (userData === null || userData === void 0 ? void 0 : userData.preferences) || {};
        // Deep merge the new preferences with existing ones
        const mergedPreferences = deepMerge(currentPreferences, preferences);
        // Update the user document
        await userRef.update({
            preferences: mergedPreferences,
            updatedAt: firestore_1.FieldValue.serverTimestamp(),
        });
        console.log(`[updateUserPreferences] Successfully updated preferences for user ${userId}`);
        return {
            success: true,
            preferences: mergedPreferences,
        };
    }
    catch (error) {
        console.error(`[updateUserPreferences] Error updating preferences:`, error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", `Failed to update preferences: ${error.message}`);
    }
});
//# sourceMappingURL=updateUserPreferences.js.map