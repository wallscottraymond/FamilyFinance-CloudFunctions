/**
 * Outflow Periods Auto-Generation Trigger
 *
 * This Cloud Function automatically creates outflow_periods when an outflow is created.
 * It is a pure orchestration trigger that delegates all business logic to utility functions.
 *
 * Memory: 512MiB, Timeout: 60s
 */
/**
 * Triggered when an outflow is created
 * Automatically generates outflow_periods for all active source periods
 */
export declare const onOutflowCreated: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowId: string;
}>>;
//# sourceMappingURL=onOutflowCreated.d.ts.map