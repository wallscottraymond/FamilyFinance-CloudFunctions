"use strict";
/**
 * Relink Attempts Cleanup Scheduled Function
 *
 * Daily retention cleanup of old Plaid relink-attempt records (30-day window).
 *
 * Schedule: Daily at 3:30 AM UTC.
 *
 * @module entry/scheduled/cleanup_relink_attempts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_relink_attempts_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const observability_1 = require("../../observability");
const cleanup_relink_attempts_orchestrator_1 = require("../../orchestrators/infrastructure/cleanup_relink_attempts.orchestrator");
/**
 * Scheduled cleanup of old relink-attempt records.
 */
exports.cleanup_relink_attempts_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: "30 3 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, cleanup_relink_attempts_orchestrator_1.cleanup_relink_attempts)(ctx);
    console.log(JSON.stringify(Object.assign({ severity: "INFO", message: "Relink attempts cleanup completed", trace_id: ctx.trace_id }, result)));
});
//# sourceMappingURL=cleanup_relink_attempts.scheduled.js.map