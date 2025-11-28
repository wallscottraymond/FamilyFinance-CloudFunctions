/**
 * Outflow Summary Update on Outflow Name Changes
 *
 * This trigger updates all affected outflow summaries when an outflow's
 * merchantName or userCustomName changes. It ensures denormalized names
 * stay in sync across all period entries.
 *
 * Memory: 512MiB, Timeout: 60s (higher limits due to potentially updating multiple summaries)
 */
/**
 * Triggered when an outflow is updated
 * Updates all affected summaries if merchantName or userCustomName changed
 */
export declare const onOutflowUpdatedSummary: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    outflowId: string;
}>>;
//# sourceMappingURL=onOutflowUpdatedSummary.d.ts.map