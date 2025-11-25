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

import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';

/**
 * Helper to extract user IDs from group members array
 */
function extractMemberIds(members: any[]): string[] {
  if (!Array.isArray(members)) return [];

  return members
    .map((member: any) => {
      if (typeof member === 'string') return member;
      if (member && member.userId) return member.userId;
      return null;
    })
    .filter((id): id is string => id !== null);
}

/**
 * Update accessibleBy for all resources of a specific collection
 */
async function updateResourceCollection(
  db: admin.firestore.Firestore,
  collectionName: string,
  groupId: string,
  newMemberIds: string[]
): Promise<number> {
  console.log(`[updateResourceCollection] Updating ${collectionName} for group ${groupId}`);

  // Find all resources belonging to this group
  const resourcesSnapshot = await db.collection(collectionName)
    .where('groupId', '==', groupId)
    .get();

  if (resourcesSnapshot.empty) {
    console.log(`[updateResourceCollection] No ${collectionName} found for group ${groupId}`);
    return 0;
  }

  console.log(`[updateResourceCollection] Found ${resourcesSnapshot.size} ${collectionName} to update`);

  // Update in batches (Firestore limit: 500 writes per batch)
  const BATCH_SIZE = 500;
  let totalUpdated = 0;

  for (let i = 0; i < resourcesSnapshot.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchDocs = resourcesSnapshot.docs.slice(i, i + BATCH_SIZE);

    batchDocs.forEach((doc) => {
      const resource = doc.data();

      // Build new accessibleBy array: owner + all group members (deduplicated)
      const ownerId = resource.ownerId || resource.userId || resource.createdBy;
      const accessibleBy = new Set<string>();

      // Add owner
      if (ownerId) {
        accessibleBy.add(ownerId);
      }

      // Add all group members
      newMemberIds.forEach(memberId => accessibleBy.add(memberId));

      // Update the document
      batch.update(doc.ref, {
        accessibleBy: Array.from(accessibleBy),
        memberIds: Array.from(accessibleBy), // Legacy field
        updatedAt: admin.firestore.Timestamp.now()
      });
    });

    await batch.commit();
    totalUpdated += batchDocs.length;

    console.log(`[updateResourceCollection] Updated batch ${Math.floor(i / BATCH_SIZE) + 1} for ${collectionName}`);
  }

  console.log(`[updateResourceCollection] Updated ${totalUpdated} ${collectionName} for group ${groupId}`);
  return totalUpdated;
}

/**
 * Update child periods that inherit from parent resources
 */
async function updateChildPeriods(
  db: admin.firestore.Firestore,
  collectionName: string,
  parentIdField: string,
  groupId: string,
  newMemberIds: string[]
): Promise<number> {
  console.log(`[updateChildPeriods] Updating ${collectionName} for group ${groupId}`);

  // Find all parent resources belonging to this group to get their IDs
  const parentsSnapshot = await db.collection(parentIdField === 'budgetId' ? 'budgets' :
                                              parentIdField === 'outflowId' ? 'outflows' : 'inflows')
    .where('groupId', '==', groupId)
    .select() // Only get document IDs for performance
    .get();

  if (parentsSnapshot.empty) {
    console.log(`[updateChildPeriods] No parent resources found for ${collectionName}`);
    return 0;
  }

  const parentIds = parentsSnapshot.docs.map(doc => doc.id);
  console.log(`[updateChildPeriods] Found ${parentIds.length} parent resources`);

  // Query periods for these parent resources
  // Note: Firestore 'in' queries are limited to 10 items, so we batch
  const IN_QUERY_LIMIT = 10;
  let totalUpdated = 0;

  for (let i = 0; i < parentIds.length; i += IN_QUERY_LIMIT) {
    const batchParentIds = parentIds.slice(i, i + IN_QUERY_LIMIT);

    const periodsSnapshot = await db.collection(collectionName)
      .where(parentIdField, 'in', batchParentIds)
      .get();

    if (periodsSnapshot.empty) continue;

    console.log(`[updateChildPeriods] Found ${periodsSnapshot.size} ${collectionName} to update`);

    // Update in batches
    const BATCH_SIZE = 500;
    for (let j = 0; j < periodsSnapshot.docs.length; j += BATCH_SIZE) {
      const batch = db.batch();
      const batchDocs = periodsSnapshot.docs.slice(j, j + BATCH_SIZE);

      batchDocs.forEach((doc) => {
        const period = doc.data();

        // Build new accessibleBy array: owner + all group members (deduplicated)
        const ownerId = period.ownerId || period.userId || period.createdBy;
        const accessibleBy = new Set<string>();

        // Add owner
        if (ownerId) {
          accessibleBy.add(ownerId);
        }

        // Add all group members
        newMemberIds.forEach(memberId => accessibleBy.add(memberId));

        // Update the document
        batch.update(doc.ref, {
          accessibleBy: Array.from(accessibleBy),
          memberIds: Array.from(accessibleBy), // Legacy field
          updatedAt: admin.firestore.Timestamp.now()
        });
      });

      await batch.commit();
      totalUpdated += batchDocs.length;
    }
  }

  console.log(`[updateChildPeriods] Updated ${totalUpdated} ${collectionName} for group ${groupId}`);
  return totalUpdated;
}

/**
 * Triggered when a group or family document is updated
 * Updates accessibleBy arrays in all related resources
 */
export const onGroupMembershipUpdate = onDocumentUpdated({
  document: '{collection}/{groupId}', // Matches both 'groups' and 'families'
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 540, // 9 minutes for large groups
}, async (event) => {
  try {
    const collection = event.params.collection as string;
    const groupId = event.params.groupId as string;

    // Only process groups and families collections
    if (collection !== 'groups' && collection !== 'families') {
      return;
    }

    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    if (!beforeData || !afterData) {
      console.log('[onGroupMembershipUpdate] No before/after data');
      return;
    }

    // Extract member IDs from before and after
    const beforeMembers = extractMemberIds(beforeData.members || beforeData.memberIds || []);
    const afterMembers = extractMemberIds(afterData.members || afterData.memberIds || []);

    // Check if membership actually changed
    const membershipChanged =
      beforeMembers.length !== afterMembers.length ||
      !beforeMembers.every(id => afterMembers.includes(id));

    if (!membershipChanged) {
      console.log('[onGroupMembershipUpdate] No membership changes detected');
      return;
    }

    console.log(`[onGroupMembershipUpdate] Group ${groupId} membership changed:`);
    console.log(`  Before: ${beforeMembers.length} members - ${beforeMembers.join(', ')}`);
    console.log(`  After: ${afterMembers.length} members - ${afterMembers.join(', ')}`);

    const db = admin.firestore();

    // Update all resource types in parallel
    const updatePromises = [
      // Primary resources
      updateResourceCollection(db, 'budgets', groupId, afterMembers),
      updateResourceCollection(db, 'transactions', groupId, afterMembers),
      updateResourceCollection(db, 'outflows', groupId, afterMembers),
      updateResourceCollection(db, 'inflows', groupId, afterMembers),

      // Child period resources
      updateChildPeriods(db, 'budget_periods', 'budgetId', groupId, afterMembers),
      updateChildPeriods(db, 'outflow_periods', 'outflowId', groupId, afterMembers),
      updateChildPeriods(db, 'inflow_periods', 'inflowId', groupId, afterMembers),
    ];

    const results = await Promise.all(updatePromises);
    const totalUpdated = results.reduce((sum, count) => sum + count, 0);

    console.log(`[onGroupMembershipUpdate] Successfully updated ${totalUpdated} resources for group ${groupId}`);

  } catch (error) {
    console.error('[onGroupMembershipUpdate] Error:', error);
    // Don't throw - we don't want to break group updates if resource sync fails
    // The next membership change will attempt to sync again
  }
});
