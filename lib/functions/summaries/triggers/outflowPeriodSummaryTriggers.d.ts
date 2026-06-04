/**
 * Outflow Period Summary Triggers
 *
 * Triggers that update user_summaries when outflow_periods change.
 * Uses the 5-layer architecture orchestrator for proper summary updates.
 *
 * IMPORTANT: The CREATE trigger has been REMOVED to prevent race conditions.
 * When outflow_periods are created in batch (e.g., new outflow generates ~95 periods),
 * the orchestrator handles summary updates AFTER all periods are saved.
 *
 * The UPDATE and DELETE triggers remain to handle individual period changes.
 *
 * @module summaries/triggers/outflowPeriodSummaryTriggers
 */
/**
 * NOTE: on_outflow_period_created_summary has been REMOVED.
 *
 * Previously, this trigger fired for each outflow_period created, which caused
 * race conditions when many periods were created at once (batch outflow creation).
 *
 * The summary update for new periods is now handled by:
 * - generate_outflow_periods.orchestrator.ts calls enqueue_user_summary_updates_from_outflow_periods()
 * - This happens AFTER all periods are saved, ensuring complete data
 */
/**
 * Trigger: When an outflow_period is updated
 *
 * Recalculates the user_summaries document for this period to reflect changes.
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export declare const on_outflow_period_updated_summary: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    outflowPeriodId: string;
}>>;
/**
 * Trigger: When an outflow_period is deleted
 *
 * Recalculates the user_summaries document to remove the deleted period entry.
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export declare const on_outflow_period_deleted_summary: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    outflowPeriodId: string;
}>>;
//# sourceMappingURL=outflowPeriodSummaryTriggers.d.ts.map