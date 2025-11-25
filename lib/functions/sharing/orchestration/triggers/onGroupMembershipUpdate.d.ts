/**
 * Group Membership Update Trigger
 *
 * This Cloud Function automatically updates accessibleBy arrays across all resources
 * when a group's membership changes (members added or removed).
 *
 * Features:
 * - Detects membership changes in groups/families collection
 * - Updates accessibleBy in all resource types (budgets, transactions, outflows, etc.)
 * - Handles batch operations for performance
 * - Updates child resources (budget_periods, outflow_periods, inflow_periods)
 * - Maintains backward compatibility with legacy memberIds field
 *
 * Memory: 1GiB (may need to update many resources), Timeout: 540s (9 minutes)
 */
/**
 * Triggered when a group or family document is updated
 * Updates accessibleBy arrays in all related resources
 */
export declare const onGroupMembershipUpdate: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    groupId: string;
    collection: string;
}>>;
//# sourceMappingURL=onGroupMembershipUpdate.d.ts.map