"use strict";
/**
 * Soft-Deleted Records Purge Scheduled Function
 *
 * Entry point for weekly permanent deletion of soft-deleted records.
 * Records are soft-deleted first (isDeleted=true) to allow for recovery.
 * After 30 days, they are permanently purged.
 *
 * Schedule: Sundays at 5:00 AM UTC
 *
 * @module entry/scheduled/purge_soft_deleted
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.purge_soft_deleted_scheduled = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../orchestrators/infrastructure");
/**
 * Scheduled purge of soft-deleted records.
 */
exports.purge_soft_deleted_scheduled = (0, scheduler_1.onSchedule)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ schedule: "0 5 * * 0", timeZone: "UTC", memory: "512MiB", timeoutSeconds: 540 }, async () => {
    const ctx = (0, observability_1.create_trace_context)();
    const result = await (0, infrastructure_1.purge_soft_deleted)(ctx);
    console.log(JSON.stringify({
        severity: "INFO",
        message: "Soft-delete purge completed",
        trace_id: ctx.trace_id,
        total_purged: result.total_purged,
        collections: result.collections.map((c) => ({
            collection: c.collection,
            purged: c.purged_count,
        })),
    }));
});
//# sourceMappingURL=purge_soft_deleted.scheduled.js.map