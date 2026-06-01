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

import { getFirestore, Timestamp } from "firebase-admin/firestore";

/**
 * Job status.
 */
export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dlq";

/**
 * Job definition.
 */
export interface Job<TPayload = unknown> {
  /** Unique job ID */
  job_id: string;

  /** Job type/name */
  job_type: string;

  /** Job payload */
  payload: TPayload;

  /** Current status */
  status: JobStatus;

  /** Retry count */
  retry_count: number;

  /** Maximum retries */
  max_retries: number;

  /** Error message if failed */
  error_message?: string;

  /** When the job was created */
  created_at: Timestamp;

  /** When the job was last updated */
  updated_at: Timestamp;

  /** When to execute (for delayed jobs) */
  scheduled_for?: Timestamp;

  /** Trace ID for correlation */
  trace_id?: string;
}

/**
 * Job queue configuration.
 */
export interface JobQueueConfig {
  /** Default max retries */
  default_max_retries?: number;

  /** Default delay between retries (ms) */
  default_retry_delay_ms?: number;
}

/**
 * Collection names.
 */
const COLLECTIONS = {
  JOBS: "_jobs",
  DLQ: "_dead_letter_queue",
} as const;

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: Required<JobQueueConfig> = {
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
export async function create_job<TPayload>(
  job_type: string,
  payload: TPayload,
  options?: {
    max_retries?: number;
    delay_seconds?: number;
    trace_id?: string;
  }
): Promise<Job<TPayload>> {
  const db = getFirestore();
  const job_id = crypto.randomUUID();
  const now = Timestamp.now();

  const job: Job<TPayload> = {
    job_id,
    job_type,
    payload,
    status: "pending",
    retry_count: 0,
    max_retries: options?.max_retries ?? DEFAULT_CONFIG.default_max_retries,
    created_at: now,
    updated_at: now,
    trace_id: options?.trace_id,
  };

  if (options?.delay_seconds) {
    job.scheduled_for = Timestamp.fromMillis(
      now.toMillis() + options.delay_seconds * 1000
    );
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
export async function get_job<TPayload = unknown>(
  job_id: string
): Promise<Job<TPayload> | null> {
  const db = getFirestore();
  const doc = await db.collection(COLLECTIONS.JOBS).doc(job_id).get();

  if (!doc.exists) {
    return null;
  }

  return doc.data() as Job<TPayload>;
}

/**
 * Gets pending jobs ready for processing.
 *
 * @param job_type - Optional filter by job type
 * @param limit - Maximum jobs to return
 * @returns Array of pending jobs
 */
export async function get_pending_jobs<TPayload = unknown>(
  job_type?: string,
  limit = 10
): Promise<Job<TPayload>[]> {
  const db = getFirestore();
  const now = Timestamp.now();

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
    .map((doc) => doc.data() as Job<TPayload>)
    .filter((job) => {
      if (!job.scheduled_for) return true;
      return job.scheduled_for.toMillis() <= now.toMillis();
    });
}

/**
 * Marks a job as processing.
 *
 * @param job_id - Job ID
 */
export async function mark_job_processing(job_id: string): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTIONS.JOBS).doc(job_id).update({
    status: "processing",
    updated_at: Timestamp.now(),
  });
}

/**
 * Marks a job as completed.
 *
 * @param job_id - Job ID
 */
export async function mark_job_completed(job_id: string): Promise<void> {
  const db = getFirestore();
  await db.collection(COLLECTIONS.JOBS).doc(job_id).update({
    status: "completed",
    updated_at: Timestamp.now(),
  });
}

/**
 * Marks a job as failed and handles retry logic.
 *
 * @param job_id - Job ID
 * @param error_message - Error message
 * @returns Whether the job will be retried
 */
export async function mark_job_failed(
  job_id: string,
  error_message: string
): Promise<boolean> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTIONS.JOBS).doc(job_id);
  const now = Timestamp.now();

  const doc = await doc_ref.get();
  if (!doc.exists) {
    return false;
  }

  const job = doc.data() as Job;
  const new_retry_count = job.retry_count + 1;

  if (new_retry_count > job.max_retries) {
    // Move to DLQ
    await move_to_dlq(job_id, error_message);
    return false;
  }

  // Calculate retry delay with exponential backoff
  const delay_ms = DEFAULT_CONFIG.default_retry_delay_ms * Math.pow(2, new_retry_count - 1);
  const scheduled_for = Timestamp.fromMillis(now.toMillis() + delay_ms);

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
export async function move_to_dlq(
  job_id: string,
  error_message: string
): Promise<void> {
  const db = getFirestore();
  const now = Timestamp.now();

  const job_doc = await db.collection(COLLECTIONS.JOBS).doc(job_id).get();
  if (!job_doc.exists) {
    return;
  }

  const job = job_doc.data() as Job;

  // Write to DLQ
  await db.collection(COLLECTIONS.DLQ).doc(job_id).set({
    ...job,
    status: "dlq",
    error_message,
    moved_to_dlq_at: now,
    updated_at: now,
  });

  // Delete from jobs collection
  await db.collection(COLLECTIONS.JOBS).doc(job_id).delete();
}

/**
 * Reprocesses a job from the DLQ.
 *
 * @param job_id - Job ID in DLQ
 * @returns The reprocessed job or null if not found
 */
export async function reprocess_dlq_job<TPayload>(
  job_id: string
): Promise<Job<TPayload> | null> {
  const db = getFirestore();
  const now = Timestamp.now();

  const dlq_doc = await db.collection(COLLECTIONS.DLQ).doc(job_id).get();
  if (!dlq_doc.exists) {
    return null;
  }

  const dlq_job = dlq_doc.data() as Job<TPayload>;

  // Create new job with reset retry count
  const new_job: Job<TPayload> = {
    ...dlq_job,
    status: "pending",
    retry_count: 0,
    error_message: undefined,
    scheduled_for: undefined,
    updated_at: now,
  };

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
export async function list_dlq_jobs(limit = 100): Promise<Job[]> {
  const db = getFirestore();
  const snapshot = await db
    .collection(COLLECTIONS.DLQ)
    .orderBy("moved_to_dlq_at", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => doc.data() as Job);
}

/**
 * Gets the count of jobs in different states.
 *
 * @returns Job counts by status
 */
export async function get_job_stats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dlq: number;
}> {
  const db = getFirestore();

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
export async function cleanup_completed_jobs(older_than_hours = 24): Promise<number> {
  const db = getFirestore();
  const cutoff = Timestamp.fromMillis(
    Date.now() - older_than_hours * 60 * 60 * 1000
  );

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
export async function has_active_job(
  job_type: string,
  deduplication_key: string
): Promise<boolean> {
  const db = getFirestore();

  // Query for pending or processing jobs of this type
  const snapshot = await db
    .collection(COLLECTIONS.JOBS)
    .where("status", "in", ["pending", "processing"])
    .where("job_type", "==", job_type)
    .limit(50)
    .get();

  // Check if any job has the matching deduplication key in payload
  for (const doc of snapshot.docs) {
    const job = doc.data() as Job;
    if (job.payload && (job.payload as { deduplication_key?: string }).deduplication_key === deduplication_key) {
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
export async function create_job_if_not_exists<TPayload extends { deduplication_key: string }>(
  job_type: string,
  payload: TPayload,
  options?: {
    max_retries?: number;
    delay_seconds?: number;
    trace_id?: string;
  }
): Promise<Job<TPayload> | null> {
  // Check for existing active job (pending or processing)
  const exists = await has_active_job(job_type, payload.deduplication_key);

  if (exists) {
    console.log(
      `[job_queue] Skipping duplicate job: ${job_type} with key ${payload.deduplication_key}`
    );
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
export async function claim_job<TPayload = unknown>(
  job_id: string
): Promise<Job<TPayload> | null> {
  const db = getFirestore();
  const doc_ref = db.collection(COLLECTIONS.JOBS).doc(job_id);

  try {
    const job = await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(doc_ref);

      if (!doc.exists) {
        return null;
      }

      const job_data = doc.data() as Job<TPayload>;

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
        updated_at: Timestamp.now(),
      });

      return { ...job_data, status: "processing" as const };
    });

    return job;
  } catch {
    return null;
  }
}
