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

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import { purge_soft_deleted } from "../../orchestrators/infrastructure";

/**
 * Scheduled purge of soft-deleted records.
 */
export const purge_soft_deleted_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "0 5 * * 0", timeZone: "UTC", memory: "512MiB", timeoutSeconds: 540 },
  async () => {
    const ctx = create_trace_context();

    const result = await purge_soft_deleted(ctx);

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
  }
);
