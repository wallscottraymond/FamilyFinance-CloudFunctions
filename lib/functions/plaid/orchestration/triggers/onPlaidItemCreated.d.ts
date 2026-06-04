/**
 * Plaid Item Created Trigger
 *
 * @deprecated This trigger is deprecated and will be removed in a future release.
 * Use the new architecture-compliant trigger at:
 * `src/functions/entry/triggers/on_plaid_item_created.trigger.ts`
 *
 * The new trigger follows the 5-layer architecture and:
 * - Uses idempotency to prevent duplicate processing
 * - Creates accounts properly (fixing the missing account creation bug)
 * - Has full observability with tracing
 *
 * Firestore trigger that automatically runs when a new plaid_item is created.
 * Orchestrates the complete Plaid data synchronization workflow:
 * 1. Sync account balances
 * 2. Sync transactions (with splits)
 * 3. Sync recurring transactions (inflow/outflow)
 *
 * This ensures all Plaid data is consistently synchronized whenever a user
 * links a new bank account.
 *
 * Memory: 1GiB, Timeout: 540s (9 minutes)
 */
/**
 * Firestore trigger on plaid_items/{itemDocId}
 *
 * Automatically syncs all Plaid data when a new item is created
 */
export declare const onPlaidItemCreated: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    itemDocId: string;
}>>;
//# sourceMappingURL=onPlaidItemCreated.d.ts.map