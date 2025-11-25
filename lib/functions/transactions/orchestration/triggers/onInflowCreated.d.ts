/**
 * Inflow Periods Auto-Generation
 *
 * This Cloud Function automatically creates inflow_periods when an inflow is created.
 * It generates periods for all period types by integrating with the source_periods collection
 * and calculating cycle-based earning amounts for each period.
 *
 * Key Features:
 * - Integration with existing source_periods collection
 * - Cycle-based earning calculation (daily rate × period days)
 * - Payment receipt date tracking and period alignment
 * - Support for all Plaid recurring frequencies (WEEKLY, MONTHLY, QUARTERLY, ANNUALLY)
 * - Proper error handling for missing source periods
 * - Edge case handling for different month lengths and leap years
 *
 * Memory: 512MiB, Timeout: 60s
 */
/**
 * Triggered when an inflow is created
 * Automatically generates inflow_periods for all active source periods
 */
export declare const onInflowCreated: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    inflowId: string;
}>>;
//# sourceMappingURL=onInflowCreated.d.ts.map