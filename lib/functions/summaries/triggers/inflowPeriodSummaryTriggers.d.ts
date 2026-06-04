/**
 * Inflow Period Summary Triggers
 *
 * Triggers that update user_summaries when inflow_periods change.
 * Uses the 5-layer architecture orchestrator for proper summary updates.
 *
 * IMPORTANT: The CREATE trigger has been REMOVED to prevent race conditions.
 * When inflow_periods are created in batch (e.g., new inflow generates ~50 periods),
 * the orchestrator or batch operation should handle summary updates AFTER all periods are saved.
 *
 * The UPDATE and DELETE triggers remain to handle individual period changes.
 *
 * @module summaries/triggers/inflowPeriodSummaryTriggers
 */
/**
 * NOTE: on_inflow_period_created_period_summary has been REMOVED.
 *
 * Previously, this trigger fired for each inflow_period created, which caused
 * race conditions when many periods were created at once (batch inflow creation).
 *
 * The summary update for new periods should be handled by:
 * - The inflow creation orchestrator calling enqueue_user_summary_updates_from_inflow_periods()
 * - This happens AFTER all periods are saved, ensuring complete data
 */
/**
 * Trigger: Update user period summary when an inflow period is updated
 *
 * When an inflow_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export declare const on_inflow_period_updated_period_summary: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    inflowPeriodId: string;
}>>;
/**
 * Trigger: Update user period summary when an inflow period is deleted
 *
 * When an inflow_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export declare const on_inflow_period_deleted_period_summary: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    inflowPeriodId: string;
}>>;
//# sourceMappingURL=inflowPeriodSummaryTriggers.d.ts.map