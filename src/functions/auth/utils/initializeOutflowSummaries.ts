import * as admin from 'firebase-admin';
import { PeriodType } from '../../../types';

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

/**
 * Initialize outflow summary documents for a new user
 * Creates 3 empty summary documents (monthly, weekly, bi-weekly)
 */
export async function initializeOutflowSummaries(userId: string): Promise<void> {
  console.log(`📊 Initializing outflow summaries for user: ${userId}`);

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setFullYear(now.getFullYear() - 1);
  const windowEnd = new Date(now);
  windowEnd.setFullYear(now.getFullYear() + 1);

  const periodTypes: PeriodType[] = ['MONTHLY', 'WEEKLY', 'BI_MONTHLY'];

  const batch = db.batch();

  for (const periodType of periodTypes) {
    const docId = `${userId}_${periodType.toLowerCase()}`;
    const docRef = db.collection('outflowSummaries').doc(docId);

    // Check if document already exists
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      console.log(`✓ Summary already exists: ${docId}`);
      continue;
    }

    const summary = {
      ownerId: userId,
      ownerType: 'user',
      periodType,
      resourceType: 'outflow',
      windowStart: Timestamp.fromDate(windowStart),
      windowEnd: Timestamp.fromDate(windowEnd),
      periods: [], // Empty initially
      totalItemCount: 0,
      lastRecalculated: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    batch.set(docRef, summary);
    console.log(`✓ Creating summary: ${docId}`);
  }

  await batch.commit();
  console.log(`✅ Initialized ${periodTypes.length} outflow summaries for user ${userId}`);
}

/**
 * Initialize group outflow summary documents for a group
 * Creates 3 empty summary documents (monthly, weekly, bi-weekly)
 */
export async function initializeGroupOutflowSummaries(groupId: string): Promise<void> {
  console.log(`📊 Initializing group outflow summaries for group: ${groupId}`);

  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setFullYear(now.getFullYear() - 1);
  const windowEnd = new Date(now);
  windowEnd.setFullYear(now.getFullYear() + 1);

  const periodTypes: PeriodType[] = ['MONTHLY', 'WEEKLY', 'BI_MONTHLY'];

  const batch = db.batch();

  for (const periodType of periodTypes) {
    const docId = `${groupId}_${periodType.toLowerCase()}`;
    const docRef = db.collection('groupOutflowSummaries').doc(docId);

    // Check if document already exists
    const existingDoc = await docRef.get();
    if (existingDoc.exists) {
      console.log(`✓ Group summary already exists: ${docId}`);
      continue;
    }

    const summary = {
      ownerId: groupId,
      ownerType: 'group',
      periodType,
      resourceType: 'outflow',
      windowStart: Timestamp.fromDate(windowStart),
      windowEnd: Timestamp.fromDate(windowEnd),
      periods: [], // Empty initially
      totalItemCount: 0,
      lastRecalculated: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    batch.set(docRef, summary);
    console.log(`✓ Creating group summary: ${docId}`);
  }

  await batch.commit();
  console.log(`✅ Initialized ${periodTypes.length} group outflow summaries for group ${groupId}`);
}
