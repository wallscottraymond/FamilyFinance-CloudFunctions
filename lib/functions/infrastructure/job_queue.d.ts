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
import { Timestamp } from "firebase-admin/firestore";
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
export declare function create_job<TPayload>(job_type: string, payload: TPayload, options?: {
    max_retries?: number;
    delay_seconds?: number;
    trace_id?: string;
}): Promise<Job<TPayload>>;
/**
 * Gets a job by ID.
 *
 * @param job_id - Job ID
 * @returns The job or null if not found
 */
export declare function get_job<TPayload = unknown>(job_id: string): Promise<Job<TPayload> | null>;
/**
 * Gets pending jobs ready for processing.
 *
 * @param job_type - Optional filter by job type
 * @param limit - Maximum jobs to return
 * @returns Array of pending jobs
 */
export declare function get_pending_jobs<TPayload = unknown>(job_type?: string, limit?: number): Promise<Job<TPayload>[]>;
/**
 * Marks a job as processing.
 *
 * @param job_id - Job ID
 */
export declare function mark_job_processing(job_id: string): Promise<void>;
/**
 * Marks a job as completed.
 *
 * @param job_id - Job ID
 */
export declare function mark_job_completed(job_id: string): Promise<void>;
/**
 * Marks a job as failed and handles retry logic.
 *
 * @param job_id - Job ID
 * @param error_message - Error message
 * @returns Whether the job will be retried
 */
export declare function mark_job_failed(job_id: string, error_message: string): Promise<boolean>;
/**
 * Moves a job to the dead letter queue.
 *
 * @param job_id - Job ID
 * @param error_message - Final error message
 */
export declare function move_to_dlq(job_id: string, error_message: string): Promise<void>;
/**
 * Reprocesses a job from the DLQ.
 *
 * @param job_id - Job ID in DLQ
 * @returns The reprocessed job or null if not found
 */
export declare function reprocess_dlq_job<TPayload>(job_id: string): Promise<Job<TPayload> | null>;
/**
 * Lists jobs in the DLQ.
 *
 * @param limit - Maximum number of jobs to return
 * @returns Array of DLQ jobs
 */
export declare function list_dlq_jobs(limit?: number): Promise<Job[]>;
/**
 * Gets the count of jobs in different states.
 *
 * @returns Job counts by status
 */
export declare function get_job_stats(): Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    dlq: number;
}>;
/**
 * Cleans up old completed jobs.
 *
 * @param older_than_hours - Delete completed jobs older than this
 * @returns Number of jobs deleted
 */
export declare function cleanup_completed_jobs(older_than_hours?: number): Promise<number>;
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
export declare function has_active_job(job_type: string, deduplication_key: string): Promise<boolean>;
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
export declare function create_job_if_not_exists<TPayload extends {
    deduplication_key: string;
}>(job_type: string, payload: TPayload, options?: {
    max_retries?: number;
    delay_seconds?: number;
    trace_id?: string;
}): Promise<Job<TPayload> | null>;
/**
 * Claims a job for processing using a transaction.
 * Prevents multiple workers from processing the same job.
 *
 * @param job_id - Job ID to claim
 * @returns The claimed job or null if already claimed
 */
export declare function claim_job<TPayload = unknown>(job_id: string): Promise<Job<TPayload> | null>;
//# sourceMappingURL=job_queue.d.ts.map