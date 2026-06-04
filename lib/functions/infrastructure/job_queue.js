"use strict";
/**
 * Job Queue
 *
 * Provides job queue management using Firestore.
 * Handles async job scheduling, retries, and dead letter queue.
 *
 * Note: This implementation uses Firestore as the queue backend.
 * For production with high throughput, consider Cloud Tasks integration.
 *
 * @module infrastructure/job_queue
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_job = create_job;
exports.get_job = get_job;
exports.get_pending_jobs = get_pending_jobs;
exports.mark_job_processing = mark_job_processing;
exports.mark_job_completed = mark_job_completed;
exports.mark_job_failed = mark_job_failed;
exports.move_to_dlq = move_to_dlq;
exports.reprocess_dlq_job = reprocess_dlq_job;
exports.list_dlq_jobs = list_dlq_jobs;
exports.get_job_stats = get_job_stats;
exports.cleanup_completed_jobs = cleanup_completed_jobs;
exports.has_active_job = has_active_job;
exports.create_job_if_not_exists = create_job_if_not_exists;
exports.claim_job = claim_job;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Collection names.
 */
const COLLECTIONS = {
    JOBS: "_jobs",
    DLQ: "_dead_letter_queue",
};
/**
 * Default configuration.
 */
const DEFAULT_CONFIG = {
    default_max_retries: 3,
    default_retry_delay_ms: 30000,
};
/**
 * Creates a new job.
 *
 * @param job_type - Type of job
 * @param payload - Job payload
 * @param options - Job options
 * @returns The created job
 *
 * @example
 * const job = await create_job("sync_transactions", {
 *   user_id: "abc123",
 *   item_id: "plaid_item_xyz",
 * });
 */
async function create_job(job_type, payload, options) {
    var _a;
    const db = (0, firestore_1.getFirestore)();
    const job_id = crypto.randomUUID();
    const now = firestore_1.Timestamp.now();
    const job = {
        job_id,
        job_type,
        payload,
        status: "pending",
        retry_count: 0,
        max_retries: (_a = options === null || options === void 0 ? void 0 : options.max_retries) !== null && _a !== void 0 ? _a : DEFAULT_CONFIG.default_max_retries,
        created_at: now,
        updated_at: now,
        trace_id: options === null || options === void 0 ? void 0 : options.trace_id,
    };
    if (options === null || options === void 0 ? void 0 : options.delay_seconds) {
        job.scheduled_for = firestore_1.Timestamp.fromMillis(now.toMillis() + options.delay_seconds * 1000);
    }
    await db.collection(COLLECTIONS.JOBS).doc(job_id).set(job);
    return job;
}
/**
 * Gets a job by ID.
 *
 * @param job_id - Job ID
 * @returns The job or null if not found
 */
async function get_job(job_id) {
    const db = (0, firestore_1.getFirestore)();
    const doc = await db.collection(COLLECTIONS.JOBS).doc(job_id).get();
    if (!doc.exists) {
        return null;
    }
    return doc.data();
}
/**
 * Gets pending jobs ready for processing.
 *
 * @param job_type - Optional filter by job type
 * @param limit - Maximum jobs to return
 * @returns Array of pending jobs
 */
async function get_pending_jobs(job_type, limit = 10) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    let query = db
        .collection(COLLECTIONS.JOBS)
        .where("status", "==", "pending");
    if (job_type) {
        query = query.where("job_type", "==", job_type);
    }
    // Get jobs that are either not scheduled or scheduled for now/past
    const snapshot = await query
        .orderBy("created_at", "asc")
        .limit(limit)
        .get();
    // Filter out jobs scheduled for the future
    return snapshot.docs
        .map((doc) => doc.data())
        .filter((job) => {
        if (!job.scheduled_for)
            return true;
        return job.scheduled_for.toMillis() <= now.toMillis();
    });
}
/**
 * Marks a job as processing.
 *
 * @param job_id - Job ID
 */
async function mark_job_processing(job_id) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTIONS.JOBS).doc(job_id).update({
        status: "processing",
        updated_at: firestore_1.Timestamp.now(),
    });
}
/**
 * Marks a job as completed.
 *
 * @param job_id - Job ID
 */
async function mark_job_completed(job_id) {
    const db = (0, firestore_1.getFirestore)();
    await db.collection(COLLECTIONS.JOBS).doc(job_id).update({
        status: "completed",
        updated_at: firestore_1.Timestamp.now(),
    });
}
/**
 * Marks a job as failed and handles retry logic.
 *
 * @param job_id - Job ID
 * @param error_message - Error message
 * @returns Whether the job will be retried
 */
async function mark_job_failed(job_id, error_message) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTIONS.JOBS).doc(job_id);
    const now = firestore_1.Timestamp.now();
    const doc = await doc_ref.get();
    if (!doc.exists) {
        return false;
    }
    const job = doc.data();
    const new_retry_count = job.retry_count + 1;
    if (new_retry_count > job.max_retries) {
        // Move to DLQ
        await move_to_dlq(job_id, error_message);
        return false;
    }
    // Calculate retry delay with exponential backoff
    const delay_ms = DEFAULT_CONFIG.default_retry_delay_ms * Math.pow(2, new_retry_count - 1);
    const scheduled_for = firestore_1.Timestamp.fromMillis(now.toMillis() + delay_ms);
    // Update retry count and schedule retry
    await doc_ref.update({
        status: "pending",
        retry_count: new_retry_count,
        error_message,
        scheduled_for,
        updated_at: now,
    });
    return true;
}
/**
 * Moves a job to the dead letter queue.
 *
 * @param job_id - Job ID
 * @param error_message - Final error message
 */
async function move_to_dlq(job_id, error_message) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    const job_doc = await db.collection(COLLECTIONS.JOBS).doc(job_id).get();
    if (!job_doc.exists) {
        return;
    }
    const job = job_doc.data();
    // Write to DLQ
    await db.collection(COLLECTIONS.DLQ).doc(job_id).set(Object.assign(Object.assign({}, job), { status: "dlq", error_message, moved_to_dlq_at: now, updated_at: now }));
    // Delete from jobs collection
    await db.collection(COLLECTIONS.JOBS).doc(job_id).delete();
}
/**
 * Reprocesses a job from the DLQ.
 *
 * @param job_id - Job ID in DLQ
 * @returns The reprocessed job or null if not found
 */
async function reprocess_dlq_job(job_id) {
    const db = (0, firestore_1.getFirestore)();
    const now = firestore_1.Timestamp.now();
    const dlq_doc = await db.collection(COLLECTIONS.DLQ).doc(job_id).get();
    if (!dlq_doc.exists) {
        return null;
    }
    const dlq_job = dlq_doc.data();
    // Create new job with reset retry count
    const new_job = Object.assign(Object.assign({}, dlq_job), { status: "pending", retry_count: 0, error_message: undefined, scheduled_for: undefined, updated_at: now });
    await db.collection(COLLECTIONS.JOBS).doc(job_id).set(new_job);
    await db.collection(COLLECTIONS.DLQ).doc(job_id).delete();
    return new_job;
}
/**
 * Lists jobs in the DLQ.
 *
 * @param limit - Maximum number of jobs to return
 * @returns Array of DLQ jobs
 */
async function list_dlq_jobs(limit = 100) {
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db
        .collection(COLLECTIONS.DLQ)
        .orderBy("moved_to_dlq_at", "desc")
        .limit(limit)
        .get();
    return snapshot.docs.map((doc) => doc.data());
}
/**
 * Gets the count of jobs in different states.
 *
 * @returns Job counts by status
 */
async function get_job_stats() {
    const db = (0, firestore_1.getFirestore)();
    const [pending, processing, completed, failed, dlq] = await Promise.all([
        db.collection(COLLECTIONS.JOBS).where("status", "==", "pending").count().get(),
        db.collection(COLLECTIONS.JOBS).where("status", "==", "processing").count().get(),
        db.collection(COLLECTIONS.JOBS).where("status", "==", "completed").count().get(),
        db.collection(COLLECTIONS.JOBS).where("status", "==", "failed").count().get(),
        db.collection(COLLECTIONS.DLQ).count().get(),
    ]);
    return {
        pending: pending.data().count,
        processing: processing.data().count,
        completed: completed.data().count,
        failed: failed.data().count,
        dlq: dlq.data().count,
    };
}
/**
 * Cleans up old completed jobs.
 *
 * @param older_than_hours - Delete completed jobs older than this
 * @returns Number of jobs deleted
 */
async function cleanup_completed_jobs(older_than_hours = 24) {
    const db = (0, firestore_1.getFirestore)();
    const cutoff = firestore_1.Timestamp.fromMillis(Date.now() - older_than_hours * 60 * 60 * 1000);
    const old_jobs = await db
        .collection(COLLECTIONS.JOBS)
        .where("status", "==", "completed")
        .where("updated_at", "<", cutoff)
        .limit(500)
        .get();
    if (old_jobs.empty) {
        return 0;
    }
    const batch = db.batch();
    old_jobs.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });
    await batch.commit();
    return old_jobs.size;
}
/**
 * Checks if an active job (pending or processing) already exists with the given deduplication key.
 *
 * Used to prevent enqueueing duplicate jobs for the same logical operation.
 * The deduplication_key is stored in the job payload.
 *
 * Checks both "pending" and "processing" statuses to prevent creating duplicates
 * while a job is currently being processed.
 *
 * @param job_type - Job type to check
 * @param deduplication_key - Unique key for deduplication (e.g., summary_id)
 * @returns True if an active job exists, false otherwise
 */
async function has_active_job(job_type, deduplication_key) {
    const db = (0, firestore_1.getFirestore)();
    // Query for pending or processing jobs of this type
    const snapshot = await db
        .collection(COLLECTIONS.JOBS)
        .where("status", "in", ["pending", "processing"])
        .where("job_type", "==", job_type)
        .limit(50)
        .get();
    // Check if any job has the matching deduplication key in payload
    for (const doc of snapshot.docs) {
        const job = doc.data();
        if (job.payload && job.payload.deduplication_key === deduplication_key) {
            return true;
        }
    }
    return false;
}
/**
 * Creates a job only if no active job (pending or processing) exists with the same deduplication key.
 *
 * This is the recommended way to enqueue jobs that may be triggered multiple times
 * for the same logical operation (e.g., summary updates from multiple trigger events).
 *
 * @param job_type - Type of job
 * @param payload - Job payload (must include deduplication_key)
 * @param options - Job options
 * @returns The created job, or null if a duplicate exists
 */
async function create_job_if_not_exists(job_type, payload, options) {
    // Check for existing active job (pending or processing)
    const exists = await has_active_job(job_type, payload.deduplication_key);
    if (exists) {
        console.log(`[job_queue] Skipping duplicate job: ${job_type} with key ${payload.deduplication_key}`);
        return null;
    }
    // Create the job
    return create_job(job_type, payload, options);
}
/**
 * Claims a job for processing using a transaction.
 * Prevents multiple workers from processing the same job.
 *
 * @param job_id - Job ID to claim
 * @returns The claimed job or null if already claimed
 */
async function claim_job(job_id) {
    const db = (0, firestore_1.getFirestore)();
    const doc_ref = db.collection(COLLECTIONS.JOBS).doc(job_id);
    try {
        const job = await db.runTransaction(async (transaction) => {
            const doc = await transaction.get(doc_ref);
            if (!doc.exists) {
                return null;
            }
            const job_data = doc.data();
            // Only claim if pending
            if (job_data.status !== "pending") {
                return null;
            }
            // Check scheduled time
            if (job_data.scheduled_for && job_data.scheduled_for.toMillis() > Date.now()) {
                return null;
            }
            transaction.update(doc_ref, {
                status: "processing",
                updated_at: firestore_1.Timestamp.now(),
            });
            return Object.assign(Object.assign({}, job_data), { status: "processing" });
        });
        return job;
    }
    catch (_a) {
        return null;
    }
}
//# sourceMappingURL=job_queue.js.map