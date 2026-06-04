/**
 * Trigger Processing Repository
 *
 * Repository layer for trigger processing record operations.
 * Handles all Firestore access for the _trigger_processing collection.
 *
 * @module repository/infrastructure/trigger_processing
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
/**
 * Trigger processing record.
 */
export interface TriggerProcessingRecord {
    /** Unique key for the trigger event */
    key: string;
    /** Document ID that triggered the event */
    document_id: string;
    /** Firebase event ID */
    event_id: string;
    /** When the trigger was processed */
    processed_at: Timestamp;
    /** Trace ID for correlation */
    trace_id?: string;
}
/**
 * Deletes old trigger processing records.
 *
 * @param ctx - Trace context
 * @param cutoff - Delete records older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export declare function delete_old_records(ctx: TraceContext, cutoff: Timestamp, batch_size: number): Promise<{
    deleted_count: number;
}>;
/**
 * Checks if a trigger has already been processed.
 *
 * @param ctx - Trace context
 * @param key - Trigger processing key
 * @returns true if already processed
 */
export declare function is_processed(ctx: TraceContext, key: string): Promise<boolean>;
/**
 * Marks a trigger as processed.
 *
 * @param ctx - Trace context
 * @param key - Trigger processing key
 * @param document_id - Document ID that triggered the event
 * @param event_id - Firebase event ID
 */
export declare function mark_processed(ctx: TraceContext, key: string, document_id: string, event_id: string): Promise<void>;
/**
 * Gets count of trigger processing records.
 *
 * @param ctx - Trace context
 * @returns Count of records
 */
export declare function get_record_count(_ctx: TraceContext): Promise<number>;
//# sourceMappingURL=trigger_processing.repository.d.ts.map