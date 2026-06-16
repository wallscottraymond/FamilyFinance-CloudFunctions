/**
 * Backfill Recurring Reconciliation Entry Point
 * (Recurring-Period-Reconciliation Phase 7)
 *
 * Admin/one-shot callable that reconciles existing recurring docs' periods. It
 * does NOT do the work inline — it enqueues a single
 * `backfill_recurring_reconciliation` coordinator job and returns; the job
 * self-fans (per user → per recurring doc → `reconcile_recurring_period`).
 * Idempotent: safe to call repeatedly.
 *
 * Wire contract is snake_case (admin/dev-facing).
 *
 * Scope & auth:
 *   - default (no args): the CALLER's own data.
 *   - `user_id` (other than caller) or `all_users: true`: requires an `admin` claim.
 *
 * @module entry/callable/backfill_recurring_reconciliation
 */
export declare const backfill_recurring_reconciliation: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    enqueued: boolean;
    scope: string;
    trace_id: string;
}>, unknown>;
//# sourceMappingURL=backfill_recurring_reconciliation.entry.d.ts.map