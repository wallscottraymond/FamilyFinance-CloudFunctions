/**
 * Budget Period Summary Triggers
 *
 * Triggers that update user_summaries when budget_periods change.
 * Uses the 5-layer architecture orchestrator for proper summary updates.
 *
 * IMPORTANT: The CREATE trigger has been REMOVED to prevent race conditions.
 * When budget_periods are created in batch (e.g., new budget generates ~78 periods),
 * the orchestrator or batch operation should handle summary updates AFTER all periods are saved.
 *
 * The UPDATE and DELETE triggers remain to handle individual period changes.
 *
 * @module summaries/triggers/budgetPeriodSummaryTriggers
 */
/**
 * NOTE: on_budget_period_created_period_summary has been REMOVED.
 *
 * Previously, this trigger fired for each budget_period created, which caused
 * race conditions when many periods were created at once (batch budget creation).
 *
 * The summary update for new periods should be handled by:
 * - The budget creation orchestrator calling enqueue_user_summary_updates_from_budget_periods()
 * - This happens AFTER all periods are saved, ensuring complete data
 */
/**
 * Trigger: Update user period summary when a budget period is updated
 *
 * When a budget_period is updated, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export declare const on_budget_period_updated_period_summary: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    budgetPeriodId: string;
}>>;
/**
 * Trigger: Update user period summary when a budget period is deleted
 *
 * When a budget_period is deleted, this trigger recalculates the
 * user period summary for the corresponding period.
 *
 * Uses the 5-layer architecture orchestrator for proper updates.
 * Includes idempotency guard and debounce logic.
 */
export declare const on_budget_period_deleted_period_summary: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    budgetPeriodId: string;
}>>;
//# sourceMappingURL=budgetPeriodSummaryTriggers.d.ts.map