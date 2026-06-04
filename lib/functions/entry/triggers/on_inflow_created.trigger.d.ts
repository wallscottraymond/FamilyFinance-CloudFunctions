/**
 * Inflow Created Trigger
 *
 * Firestore trigger that fires when a new inflow document is created.
 * Calls the generate_inflow_periods_orchestrator to create period instances.
 *
 * This replaces the legacy onInflowCreated trigger with an architecture-compliant version
 * that follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * COEXISTENCE: During migration, this trigger checks if periods already exist
 * (created by legacy onInflowCreated). If so, it skips to avoid duplicates.
 *
 * Memory: 512MiB, Timeout: 60s
 *
 * @module entry/triggers/on_inflow_created
 */
/**
 * Firestore trigger on inflows/{inflowId}
 *
 * Automatically generates inflow_period documents when a new inflow is created.
 * Uses idempotency to prevent duplicate processing.
 */
export declare const on_inflow_created: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    inflowId: string;
}>>;
//# sourceMappingURL=on_inflow_created.trigger.d.ts.map