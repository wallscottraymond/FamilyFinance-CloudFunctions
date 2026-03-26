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
export declare const updateUserPreferences: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    preferences: any;
}>>;
//# sourceMappingURL=updateUserPreferences.d.ts.map