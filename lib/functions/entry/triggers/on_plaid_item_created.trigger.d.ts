/**
 * Plaid Item Created Trigger
 *
 * Firestore trigger that fires when a new plaid_item document is created.
 * Calls the plaid_initial_sync_orchestrator to coordinate:
 * 1. Account creation (with balances)
 * 2. Transaction sync
 * 3. Recurring transaction sync
 *
 * This replaces the old onPlaidItemCreated trigger with an architecture-compliant version.
 *
 * Memory: 1GiB, Timeout: 540s (9 minutes)
 *
 * @module entry/triggers/on_plaid_item_created
 */
/**
 * Firestore trigger on plaid_items/{itemDocId}
 *
 * Automatically runs the initial sync when a new Plaid item is created.
 * Uses idempotency to prevent duplicate processing.
 */
export declare const on_plaid_item_created: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    itemDocId: string;
}>>;
//# sourceMappingURL=on_plaid_item_created.trigger.d.ts.map