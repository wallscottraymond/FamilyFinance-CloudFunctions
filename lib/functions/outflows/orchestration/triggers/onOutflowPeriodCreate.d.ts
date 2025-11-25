/**
 * Outflow Period Post-Creation Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is created.
 * It automatically matches historical transactions to this period and
 * updates the period's payment status.
 *
 * Memory: 256MiB, Timeout: 30s
 */
/**
 * Triggered when an outflow_period is created
 * Auto-matches transactions to this specific period
 */
export declare const onOutflowPeriodCreate: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=onOutflowPeriodCreate.d.ts.map