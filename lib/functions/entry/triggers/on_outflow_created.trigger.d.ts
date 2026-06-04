/**
 * Outflow Created Trigger
 *
 * Firestore trigger that fires when a new outflow document is created.
 * Calls the generate_outflow_periods_orchestrator to create period instances.
 *
 * This replaces the legacy onOutflowCreated trigger with an architecture-compliant version
 * that follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * Memory: 512MiB, Timeout: 60s
 *
 * @module entry/triggers/on_outflow_created
 */
/**
 * Firestore trigger on outflows/{outflowId}
 *
 * Automatically generates outflow_period documents when a new outflow is created.
 * Uses idempotency to prevent duplicate processing.
 */
export declare const on_outflow_created: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowId: string;
}>>;
//# sourceMappingURL=on_outflow_created.trigger.d.ts.map