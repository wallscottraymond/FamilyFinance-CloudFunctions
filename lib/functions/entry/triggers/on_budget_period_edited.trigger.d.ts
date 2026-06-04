/**
 * On Budget Period Edited (Trigger)
 *
 * Syncs user-entered budget_period data — notes, checklist items, and modified
 * amount — across the overlapping periods of OTHER types for the same budget,
 * so an edit on a monthly period is reflected on the overlapping weekly /
 * bi-monthly periods (and vice versa).
 *
 * Reuses the existing sync utilities. Loop prevention relies on the `*SyncedAt`
 * timestamps those utilities stamp on the periods they write — if a sync
 * timestamp increased, this update was itself a sync, so we skip.
 *
 * Also handles period pause/resume (the "Pause This Period" toggle flips the
 * period's `isActive`): redistributes the period's allocation to/from Everything
 * Else via `handleBudgetPeriodPauseResume`.
 *
 * This restores the note/checklist/modified-amount + pause/resume portions of
 * the retired legacy `onBudgetPeriodUpdated` trigger. It does NOT handle rollover
 * recalculation (#6, depends on the spent pipeline). It is safe alongside the v2
 * period-generation cascade, which never writes these fields on an UPDATE.
 *
 * @module entry/triggers/on_budget_period_edited
 */
export declare const on_budget_period_edited: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    periodId: string;
}>>;
//# sourceMappingURL=on_budget_period_edited.trigger.d.ts.map