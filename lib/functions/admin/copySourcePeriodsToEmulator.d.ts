/**
 * Copy source_periods collection to emulator
 *
 * This function fetches all source_periods from production Firestore
 * and returns them as JSON that can be imported to the emulator.
 *
 * Usage from emulator:
 * Call this function, then write the results to emulator Firestore
 */
export declare const exportSourcePeriods: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    count: number;
    documents: any[];
}>>;
//# sourceMappingURL=copySourcePeriodsToEmulator.d.ts.map