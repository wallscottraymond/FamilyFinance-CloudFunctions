/**
 * On Recurring Updated (Trigger) — Recurring-Period-Reconciliation Phase 4
 *
 * Fires when a recurring outflow/inflow doc changes. When its `transactionIds`
 * list GROWS (Plaid recurring detection / webhook), enqueue a `reconcile_recurring_period`
 * job so the new transactions align to periods and the period status updates.
 *
 * Field-guard: only enqueues when `transactionIds` actually changed (ignores
 * unrelated edits). Loop-safe: the reconcile job writes only to `*_periods`,
 * never back to the recurring doc, so it can't re-trigger this.
 *
 * @module entry/triggers/on_recurring_updated
 */
type RecurringType = "outflow" | "inflow";
/** True if the recurring doc's `transactionIds` grew/changed (the field-guard). */
export declare function transaction_ids_changed(before: Record<string, unknown> | null, after: Record<string, unknown>): boolean;
/** Shared handler: enqueue a reconcile when the inbound list changed. Exported for tests. */
export declare function handle_recurring_write(recurring_type: RecurringType, recurring_id: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, event_id: string): Promise<boolean>;
export declare const on_outflow_updated: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    recurringId: string;
}>>;
export declare const on_inflow_updated: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    recurringId: string;
}>>;
export {};
//# sourceMappingURL=on_recurring_updated.trigger.d.ts.map