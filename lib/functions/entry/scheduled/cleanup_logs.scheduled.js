"use strict";
/**
 * Log Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of old log entries.
 * - Tier 1 (minimal logs): 30 days retention
 * - Tier 2 (debug logs): 7 days retention
 * - Traces: 30 days retention
 *
 * Schedule: Daily at 4:00 AM UTC
 *
 * @module entry/scheduled/cleanup_logs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_logs_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../orchestrators/infrastructure");
/**
 * Scheduled cleanup of old log entries.
 */
exports.cleanup_logs_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: "0 4 * * *", timeZone: "UTC", memory: "512MiB", timeoutSeconds: 540 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, infrastructure_1.cleanup_logs)(ctx);
    console.log(JSON.stringify({
        severity: "INFO",
        message: "Log cleanup completed",
        trace_id: ctx.trace_id,
        minimal_deleted: result.minimal.deleted_count,
        debug_deleted: result.debug.deleted_count,
        traces_deleted: result.traces.deleted_count,
        total_deleted: result.total_deleted,
    }));
});
//# sourceMappingURL=cleanup_logs.scheduled.js.map