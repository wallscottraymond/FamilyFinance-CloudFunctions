"use strict";
/**
 * Idempotency Cleanup Scheduled Function
 *
 * Entry point for daily cleanup of expired idempotency records.
 * Records expire after 24 hours.
 *
 * Schedule: Daily at 3:00 AM UTC
 *
 * @module entry/scheduled/cleanup_idempotency
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanup_idempotency_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../orchestrators/infrastructure");
/**
 * Scheduled cleanup of expired idempotency records.
 */
exports.cleanup_idempotency_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: "0 3 * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, infrastructure_1.cleanup_idempotency)(ctx);
    console.log(JSON.stringify(Object.assign({ severity: "INFO", message: "Idempotency cleanup completed", trace_id: ctx.trace_id }, result)));
});
//# sourceMappingURL=cleanup_idempotency.scheduled.js.map