/**
 * Job Created Trigger
 *
 * Processes jobs immediately when they are created in the _jobs collection.
 * This provides near-instant processing while the scheduled function serves
 * as a fallback for retries and any missed jobs.
 *
 * @module entry/triggers/on_job_created
 */
/**
 * Trigger: Process job immediately when created
 *
 * This trigger fires when a new job is added to the _jobs collection.
 * It attempts to claim and process the job immediately, providing
 * near-instant execution instead of waiting for the scheduled function.
 */
export declare const on_job_created: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    jobId: string;
}>>;
//# sourceMappingURL=on_job_created.trigger.d.ts.map