import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const db = getFirestore();

/**
 * Deep merge two objects, with source values overwriting target values
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const result = { ...target };

  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (
      sourceValue !== null &&
      typeof sourceValue === "object" &&
      !Array.isArray(sourceValue) &&
      targetValue !== null &&
      typeof targetValue === "object" &&
      !Array.isArray(targetValue)
    ) {
      // Recursively merge nested objects
      result[key] = deepMerge(targetValue as Record<string, any>, sourceValue as Record<string, any>) as T[keyof T];
    } else if (sourceValue !== undefined) {
      // Override with source value
      result[key] = sourceValue as T[keyof T];
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
export const updateUserPreferences = onCall(
  {
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    // Allow unauthenticated HTTP invocations at Cloud Run level
    // Firebase Auth token is validated inside the function via request.auth
    invoker: "public",
  },
  async (request) => {
    // Check authentication
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated to update preferences"
      );
    }

    const userId = request.auth.uid;
    const { preferences } = request.data || {};

    if (!preferences || typeof preferences !== "object") {
      throw new HttpsError(
        "invalid-argument",
        "preferences object is required"
      );
    }

    console.log(`[updateUserPreferences] Updating preferences for user ${userId}`);

    try {
      const userRef = db.collection("users").doc(userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new HttpsError(
          "not-found",
          "User document not found"
        );
      }

      const userData = userDoc.data();
      const currentPreferences = userData?.preferences || {};

      // Deep merge the new preferences with existing ones
      const mergedPreferences = deepMerge(currentPreferences, preferences);

      // Update the user document
      await userRef.update({
        preferences: mergedPreferences,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[updateUserPreferences] Successfully updated preferences for user ${userId}`);

      return {
        success: true,
        preferences: mergedPreferences,
      };
    } catch (error: any) {
      console.error(`[updateUserPreferences] Error updating preferences:`, error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        `Failed to update preferences: ${error.message}`
      );
    }
  }
);
