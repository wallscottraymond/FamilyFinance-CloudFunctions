/**
 * Job Queue Cleanup Scheduled Function
 *
 * Entry point for periodic cleanup of finished (`completed` + `failed`) docs in
 * the `_jobs` collection. Without this, every processed job is retained forever
 * (a `completed` job is never deleted by the processor), which is how the queue
 * grew to ~1.6M docs and drove Firestore storage/read cost up.
 *
 * `completed` jobs are removed after 24h; `failed` jobs are kept 7 days for
 * debugging. The purge drains in 500-doc batches up to a per-run cap, so it also
 * grinds down an existing backlog over successive runs.
 *
 * Schedule: every 30 minutes.
 *
 * @module entry/scheduled/cleanup_jobs
 */

import { onSchedule } from "firebase-functions/v2/scheduler";
import { create_trace_context } from "../../observability";
import { purge_finished_jobs } from "../../infrastructure";

/**
 * Scheduled cleanup of old finished job-queue docs.
 */
export const cleanup_jobs_scheduled = onSchedule(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { schedule: "*/30 * * * *", timeZone: "UTC", memory: "256MiB", timeoutSeconds: 540 },
  async () => {
    const ctx = create_trace_context();

    const result = await purge_finished_jobs({
      completed_older_than_hours: 24,
      failed_older_than_hours: 24 * 7,
      // High cap so the ~1.6M accumulated backlog drains over a handful of runs;
      // 500-doc batches keep well within the 540s timeout. Harmless at steady
      // state (there won't be this many finished jobs once caught up).
      max_deletes: 200_000,
    });

    console.log(JSON.stringify({
      severity: "INFO",
      message: "Job queue cleanup completed",
      trace_id: ctx.trace_id,
      ...result,
    }));
  }
);
