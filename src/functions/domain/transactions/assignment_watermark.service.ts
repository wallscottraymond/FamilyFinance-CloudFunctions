/**
 * Assignment Watermark (pure) — Code-Health-Review A1-M1.
 *
 * The per-user assignment batch re-assigns the transactions changed since its watermark
 * (`updatedAt` order). Two defects:
 *  (a) a write whose `updatedAt` is older than the newest one read, but which commits AFTER the
 *      read, was skipped for good (the watermark had already passed it) → never assigned;
 *  (b) the batch's own writes bump `updatedAt`, so the next run re-assigned them all (read cost).
 * Rules:
 *  - a row whose `updatedAt` equals the `assignedAt` the assignment wrote has not changed since it
 *    was assigned → skipped (still advances the watermark);
 *  - on the LAST page the watermark stops `COMMIT_SKEW_MS` before the read started, so a write
 *    committing just after the read is seen next run; mid-burst pages (a full page) advance to the
 *    last row so paging always moves forward.
 *
 * PURE.
 *
 * @module domain/transactions/assignment_watermark
 */

/** How far before the read a final page's watermark stops (commit latency + server clock skew). */
export const COMMIT_SKEW_MS = 2 * 60 * 1000;

export interface ChangedRow {
  id: string;
  updated_ms: number;
  /** `assignedAt` the last assignment wrote (ms), or null. */
  assigned_ms: number | null;
}

export function plan_assignment_page(
  rows: ChangedRow[],
  read_started_ms: number,
  page_limit: number
): { assign_ids: string[]; next_watermark_ms: number | null; more: boolean } {
  if (rows.length === 0) return { assign_ids: [], next_watermark_ms: null, more: false };
  const more = rows.length === page_limit;
  const last_ms = rows[rows.length - 1].updated_ms;
  const assign_ids = rows.filter((r) => r.assigned_ms !== r.updated_ms).map((r) => r.id);
  const next_watermark_ms = more ? last_ms : Math.min(last_ms, read_started_ms - COMMIT_SKEW_MS);
  return { assign_ids, next_watermark_ms, more };
}
