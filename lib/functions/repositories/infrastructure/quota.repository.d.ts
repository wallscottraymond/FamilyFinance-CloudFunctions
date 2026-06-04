/**
 * Quota Repository
 *
 * Repository layer for quota tracking operations.
 * Handles all Firestore access for _quota_tracking and _quota_snapshots.
 *
 * @module repository/infrastructure/quota
 */
import { Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
/**
 * Quota tracking document.
 */
export interface QuotaTrackingDoc {
    date: string;
    reads: number;
    writes: number;
    updated_at: Timestamp;
}
/**
 * Quota snapshot document.
 */
export interface QuotaSnapshotDoc {
    reads_percent: number;
    writes_percent: number;
    reads_count: number;
    writes_count: number;
    limits: {
        daily_reads: number;
        daily_writes: number;
    };
    timestamp: Timestamp;
}
/**
 * Gets current quota usage for today.
 *
 * @param ctx - Trace context
 * @returns Current reads and writes count
 */
export declare function get_today_usage(_ctx: TraceContext): Promise<{
    reads: number;
    writes: number;
}>;
/**
 * Increments read counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of reads to add
 */
export declare function increment_reads(ctx: TraceContext, count: number): Promise<void>;
/**
 * Increments write counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of writes to add
 */
export declare function increment_writes(ctx: TraceContext, count: number): Promise<void>;
/**
 * Saves a quota snapshot.
 *
 * @param ctx - Trace context
 * @param snapshot - Snapshot data
 */
export declare function save_snapshot(ctx: TraceContext, snapshot: Omit<QuotaSnapshotDoc, "timestamp">): Promise<void>;
/**
 * Gets the latest quota snapshot.
 *
 * @param ctx - Trace context
 * @returns Latest snapshot or null
 */
export declare function get_latest_snapshot(_ctx: TraceContext): Promise<QuotaSnapshotDoc | null>;
/**
 * Deletes old quota tracking records.
 *
 * @param ctx - Trace context
 * @param cutoff_date - Delete records before this date (YYYY-MM-DD)
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export declare function delete_old_tracking(ctx: TraceContext, cutoff_date: string, batch_size: number): Promise<{
    deleted_count: number;
}>;
/**
 * Deletes old quota snapshots.
 *
 * @param ctx - Trace context
 * @param cutoff - Delete snapshots older than this timestamp
 * @param batch_size - Maximum records to delete per batch
 * @returns Count of deleted records
 */
export declare function delete_old_snapshots(ctx: TraceContext, cutoff: Timestamp, batch_size: number): Promise<{
    deleted_count: number;
}>;
//# sourceMappingURL=quota.repository.d.ts.map