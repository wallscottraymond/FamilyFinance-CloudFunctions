/**
 * Plaid Item Created Trigger
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
export declare const onPlaidItemCreated: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    itemDocId: string;
}>>;
//# sourceMappingURL=onPlaidItemCreated.d.ts.map