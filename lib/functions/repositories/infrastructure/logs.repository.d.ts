/**
 * Logs Repository
 *
 * Repository layer for log record operations.
 * Handles all Firestore access for _logs_minimal, _logs_debug, and _traces.
 *
 * @module repository/infrastructure/logs
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
/**
 * Collection names for logs.
 */
export declare const LOG_COLLECTIONS: {
    readonly MINIMAL: "_logs_minimal";
    readonly DEBUG: "_logs_debug";
    readonly TRACES: "_traces";
};
/**
 * Deletes old log records from a collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @param cutoff - Delete records older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export declare function delete_old_records(ctx: TraceContext, collection: string, cutoff: Timestamp, batch_size: number): Promise<{
    deleted_count: number;
}>;
/**
 * Gets count of records in a log collection.
 *
 * @param ctx - Trace context
 * @param collection - Collection name
 * @returns Count of records
 */
export declare function get_record_count(ctx: TraceContext, collection: string): Promise<number>;
/**
 * Writes a minimal log entry.
 *
 * @param ctx - Trace context
 * @param entry - Log entry data
 * @returns The created document ID
 */
export declare function write_minimal_log(ctx: TraceContext, entry: Record<string, unknown>): Promise<string>;
/**
 * Writes a debug log entry.
 *
 * @param ctx - Trace context
 * @param entry - Log entry data
 * @returns The created document ID
 */
export declare function write_debug_log(ctx: TraceContext, entry: Record<string, unknown>): Promise<string>;
/**
 * Writes a trace summary.
 *
 * @param ctx - Trace context
 * @param trace_id - Trace ID (used as doc ID)
 * @param summary - Trace summary data
 */
export declare function write_trace_summary(ctx: TraceContext, trace_id: string, summary: Record<string, unknown>): Promise<void>;
//# sourceMappingURL=logs.repository.d.ts.map