/**
 * Backfill Transaction Assignments Entry Point
 *
 * Admin/one-shot callable that kicks off the assignment-engine backfill after
 * the hard cutover off the legacy increment spend model. It does NOT do the
 * work inline — it enqueues a single `backfill_assignments` coordinator job and
 * returns immediately; the job self-fans (per user → per transaction + per
 * budget) through the `_jobs` queue. Idempotent: safe to call repeatedly.
 *
 * Wire contract is snake_case (admin/dev-facing, no frontend dependency).
 *
 * Scope & auth:
 *   - default (no args): backfills the CALLER's own data.
 *   - `user_id` (other than caller) or `all_users: true`: requires an `admin`
 *     custom claim.
 *
 * @module entry/callable/backfill_transaction_assignments
 */
export declare const backfill_transaction_assignments: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    enqueued: boolean;
    scope: string;
    trace_id: string;
}>, unknown>;
//# sourceMappingURL=backfill_transaction_assignments.entry.d.ts.map