/**
 * On Derive-Input Written (Triggers) — derived-period cache invalidation
 *
 * `derive_period` reads 7 sources; five are already covered by their own triggers
 * (transactions, outflows, inflows, budget_periods). This file closes the remaining
 * OWNER-SCOPED gaps — `budgets` and `goals` — by bumping the user's derive-input version
 * so their cached periods recompute on the next read ([[Firestore-Read-Cost-Reduction]]).
 *
 * These are thin invalidation-only triggers (no orchestrator, no cascade): extract the
 * owner, fire-and-forget a version bump, done. `bump_derive_version` writes only to
 * `user_data_versions` (no trigger there), so there is no loop.
 *
 * NOT covered here: `source_periods` is a GLOBAL, non-owner-scoped calendar that changes
 * rarely (period generation extends the horizon) — a per-user version can't target it, so
 * it relies on the cache's TTL backstop (minutes) to pick up new period definitions.
 *
 * @module entry/triggers/on_derive_input_written
 */
export declare const on_budget_written: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    budgetId: string;
}>>;
export declare const on_goal_written: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    goalId: string;
}>>;
//# sourceMappingURL=on_derive_input_written.trigger.d.ts.map