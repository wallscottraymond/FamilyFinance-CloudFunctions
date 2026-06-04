/**
 * Quota Monitor
 *
 * High-level quota monitoring utilities built on the repository layer.
 * Tracks Firestore read/write quotas and triggers alerts when thresholds are exceeded.
 *
 * Note: Actual Firestore quota monitoring requires Cloud Monitoring API.
 * This implementation provides application-level tracking.
 *
 * @module infrastructure/quota_monitor
 */
import { TraceContext } from "../types";
import { QuotaSnapshotDoc } from "../repositories/infrastructure";
export { QuotaSnapshotDoc as QuotaSnapshot } from "../repositories/infrastructure";
/**
 * Quota alert thresholds.
 */
export declare const QUOTA_THRESHOLDS: {
    readonly WARNING: 80;
    readonly CRITICAL: 95;
};
/**
 * Default daily limits (free tier).
 * Adjust based on your Firebase plan.
 */
export declare const DEFAULT_LIMITS: {
    readonly DAILY_READS: 50000;
    readonly DAILY_WRITES: 20000;
};
/**
 * Increments the read counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of reads to add (default: 1)
 */
export declare function track_reads(ctx: TraceContext, count?: number): Promise<void>;
/**
 * Increments the write counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of writes to add (default: 1)
 */
export declare function track_writes(ctx: TraceContext, count?: number): Promise<void>;
/**
 * Gets current quota usage for today.
 *
 * @param ctx - Trace context
 * @returns Current reads and writes count
 */
export declare function get_current_usage(ctx: TraceContext): Promise<{
    reads: number;
    writes: number;
}>;
/**
 * Creates a quota snapshot for health checks.
 * Should be called periodically (e.g., every hour).
 *
 * @param ctx - Trace context
 * @param limits - Custom limits (optional, defaults to free tier limits)
 * @returns The created snapshot
 */
export declare function create_quota_snapshot(ctx: TraceContext, limits?: {
    daily_reads: number;
    daily_writes: number;
}): Promise<QuotaSnapshotDoc>;
/**
 * Gets the latest quota snapshot.
 *
 * @param ctx - Trace context
 * @returns Latest snapshot or null if none exists
 */
export declare function get_latest_snapshot(ctx: TraceContext): Promise<QuotaSnapshotDoc | null>;
/**
 * Checks if quota usage is at warning or critical levels.
 *
 * @param ctx - Trace context
 * @returns Alert status
 */
export declare function check_quota_alerts(ctx: TraceContext): Promise<{
    status: "ok" | "warning" | "critical";
    message?: string;
    reads_percent: number;
    writes_percent: number;
}>;
//# sourceMappingURL=quota_monitor.d.ts.map