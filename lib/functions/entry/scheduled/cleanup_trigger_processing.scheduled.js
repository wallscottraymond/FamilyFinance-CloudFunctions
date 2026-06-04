"use strict";
/**
 * Trigger Processing Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of old trigger processing records.
 * These records track which triggers have been processed to ensure idempotency.
 *
 * Records expire after 7 days.
 *
 * Schedule: Daily at 3:30 AM UTC
 *
 * @module entry/scheduled/cleanup_trigger_processing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_trigger_processing_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../orchestrators/infrastructure");
/**
 * Scheduled cleanup of old trigger processing records.
 */
exports.cleanup_trigger_processing_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: "30 3 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, infrastructure_1.cleanup_trigger_processing)(ctx);
    console.log(JSON.stringify(Object.assign({ severity: "INFO", message: "Trigger processing cleanup completed", trace_id: ctx.trace_id }, result)));
});
//# sourceMappingURL=cleanup_trigger_processing.scheduled.js.map