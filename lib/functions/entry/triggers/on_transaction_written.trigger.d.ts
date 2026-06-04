/**
 * On Transaction Written (Trigger) — Transaction Assignment Engine entry
 *
 * Thin trigger: extracts the before/after snapshots and the user, then calls
 * exactly ONE orchestrator (`process_transaction_written`) which decides what
 * to enqueue. All branching/field-guard/budget-scope logic lives there.
 *
 * Loop prevention: the engine's own write changes assignment fields, which the
 * field-guard sees as relevant → one redundant job, which skip-if-unchanged
 * no-ops (no further write, no further trigger). Converges in one extra pass.
 *
 * @module entry/triggers/on_transaction_written
 */
export declare const on_transaction_written: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    transactionId: string;
}>>;
//# sourceMappingURL=on_transaction_written.trigger.d.ts.map