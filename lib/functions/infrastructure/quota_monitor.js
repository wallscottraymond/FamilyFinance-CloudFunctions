"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LIMITS = exports.QUOTA_THRESHOLDS = void 0;
exports.track_reads = track_reads;
exports.track_writes = track_writes;
exports.get_current_usage = get_current_usage;
exports.create_quota_snapshot = create_quota_snapshot;
exports.get_latest_snapshot = get_latest_snapshot;
exports.check_quota_alerts = check_quota_alerts;
const infrastructure_1 = require("../repositories/infrastructure");
/**
 * Quota alert thresholds.
 */
exports.QUOTA_THRESHOLDS = {
    WARNING: 80, // 80% of quota
    CRITICAL: 95, // 95% of quota
};
/**
 * Default daily limits (free tier).
 * Adjust based on your Firebase plan.
 */
exports.DEFAULT_LIMITS = {
    DAILY_READS: 50000,
    DAILY_WRITES: 20000,
};
/**
 * Increments the read counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of reads to add (default: 1)
 */
async function track_reads(ctx, count = 1) {
    await (0, infrastructure_1.increment_reads)(ctx, count);
}
/**
 * Increments the write counter for today.
 *
 * @param ctx - Trace context
 * @param count - Number of writes to add (default: 1)
 */
async function track_writes(ctx, count = 1) {
    await (0, infrastructure_1.increment_writes)(ctx, count);
}
/**
 * Gets current quota usage for today.
 *
 * @param ctx - Trace context
 * @returns Current reads and writes count
 */
async function get_current_usage(ctx) {
    return (0, infrastructure_1.get_today_usage)(ctx);
}
/**
 * Creates a quota snapshot for health checks.
 * Should be called periodically (e.g., every hour).
 *
 * @param ctx - Trace context
 * @param limits - Custom limits (optional, defaults to free tier limits)
 * @returns The created snapshot
 */
async function create_quota_snapshot(ctx, limits) {
    var _a, _b;
    const usage = await (0, infrastructure_1.get_today_usage)(ctx);
    const effective_limits = {
        daily_reads: (_a = limits === null || limits === void 0 ? void 0 : limits.daily_reads) !== null && _a !== void 0 ? _a : exports.DEFAULT_LIMITS.DAILY_READS,
        daily_writes: (_b = limits === null || limits === void 0 ? void 0 : limits.daily_writes) !== null && _b !== void 0 ? _b : exports.DEFAULT_LIMITS.DAILY_WRITES,
    };
    const snapshot = {
        reads_percent: Math.round((usage.reads / effective_limits.daily_reads) * 100),
        writes_percent: Math.round((usage.writes / effective_limits.daily_writes) * 100),
        reads_count: usage.reads,
        writes_count: usage.writes,
        limits: effective_limits,
    };
    await (0, infrastructure_1.save_quota_snapshot)(ctx, snapshot);
    return Object.assign({}, snapshot);
}
/**
 * Gets the latest quota snapshot.
 *
 * @param ctx - Trace context
 * @returns Latest snapshot or null if none exists
 */
async function get_latest_snapshot(ctx) {
    return (0, infrastructure_1.get_latest_quota_snapshot)(ctx);
}
/**
 * Checks if quota usage is at warning or critical levels.
 *
 * @param ctx - Trace context
 * @returns Alert status
 */
async function check_quota_alerts(ctx) {
    const snapshot = await (0, infrastructure_1.get_latest_quota_snapshot)(ctx);
    if (!snapshot) {
        return {
            status: "ok",
            message: "No quota data available",
            reads_percent: 0,
            writes_percent: 0,
        };
    }
    const max_percent = Math.max(snapshot.reads_percent, snapshot.writes_percent);
    if (max_percent >= exports.QUOTA_THRESHOLDS.CRITICAL) {
        const msg = `Quota critical: reads ${snapshot.reads_percent}%, ` +
            `writes ${snapshot.writes_percent}%`;
        return {
            status: "critical",
            message: msg,
            reads_percent: snapshot.reads_percent,
            writes_percent: snapshot.writes_percent,
        };
    }
    if (max_percent >= exports.QUOTA_THRESHOLDS.WARNING) {
        const msg = `Quota warning: reads ${snapshot.reads_percent}%, ` +
            `writes ${snapshot.writes_percent}%`;
        return {
            status: "warning",
            message: msg,
            reads_percent: snapshot.reads_percent,
            writes_percent: snapshot.writes_percent,
        };
    }
    return {
        status: "ok",
        reads_percent: snapshot.reads_percent,
        writes_percent: snapshot.writes_percent,
    };
}
//# sourceMappingURL=quota_monitor.js.map