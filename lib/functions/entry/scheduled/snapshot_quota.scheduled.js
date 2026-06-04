"use strict";
/**
 * Quota Snapshot Scheduled Functions
 *
 * Entry points for quota monitoring:
 * - snapshot_quota_scheduled: Creates hourly quota snapshots
 * - cleanup_quota_scheduled: Cleans up old quota data daily
 *
 * @module entry/scheduled/snapshot_quota
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_quota_scheduled = exports.snapshot_quota_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../orchestrators/infrastructure");
const config_1 = require("../../infrastructure/config");
/**
 * Scheduled quota snapshot creation.
 * Runs every hour at :15 minutes.
 *
 * Creates a snapshot of current quota usage and checks for alerts.
 */
exports.snapshot_quota_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: "15 * * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 60 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, infrastructure_1.snapshot_quota)(ctx);
    // Get config for threshold values in logs
    const config = await (0, config_1.get_infrastructure_config)();
    // Log based on alert status
    if (result.alert_status === "critical") {
        console.log(JSON.stringify({
            severity: "ERROR",
            message: result.alert_message,
            trace_id: ctx.trace_id,
            alert_status: result.alert_status,
            reads_percent: result.reads_percent,
            writes_percent: result.writes_percent,
            threshold: config.quota.critical_threshold_percent,
        }));
    }
    else if (result.alert_status === "warning") {
        console.log(JSON.stringify({
            severity: "WARNING",
            message: result.alert_message,
            trace_id: ctx.trace_id,
            alert_status: result.alert_status,
            reads_percent: result.reads_percent,
            writes_percent: result.writes_percent,
            threshold: config.quota.warning_threshold_percent,
        }));
    }
    console.log(JSON.stringify({
        severity: "INFO",
        message: "Quota snapshot created",
        trace_id: ctx.trace_id,
        reads_percent: result.reads_percent,
        writes_percent: result.writes_percent,
        reads_count: result.reads_count,
        writes_count: result.writes_count,
    }));
});
/**
 * Scheduled cleanup of old quota data.
 * Runs daily at 4:30 AM UTC.
 *
 * Cleans up quota tracking and snapshot data older than 30 days.
 */
exports.cleanup_quota_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: "30 4 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 120 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, infrastructure_1.cleanup_quota)(ctx);
    console.log(JSON.stringify(Object.assign({ severity: "INFO", message: "Quota data cleanup completed", trace_id: ctx.trace_id }, result)));
});
//# sourceMappingURL=snapshot_quota.scheduled.js.map