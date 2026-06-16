/**
 * On Budget Period Edited (Trigger)
 *
 * Syncs user-entered budget_period data — notes, checklist items, and modified
 * amount — across the overlapping periods of OTHER types for the same budget,
 * so an edit on a monthly period is reflected on the overlapping weekly /
 * bi-monthly periods (and vice versa).
 *
 * Thin trigger: extracts the before/after snapshots, applies an event-id
 * idempotency guard, and calls exactly ONE orchestrator
 * (`process_budget_period_edited`) which holds the change-detection, loop
 * prevention, and the cross-period sync. Restores the note/checklist/
 * modified-amount + pause/resume portions of the retired legacy
 * `onBudgetPeriodUpdated` trigger (rollover #6 still deferred).
 *
 * @module entry/triggers/on_budget_period_edited
 */
export declare const on_budget_period_edited: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    periodId: string;
}>>;
//# sourceMappingURL=on_budget_period_edited.trigger.d.ts.map