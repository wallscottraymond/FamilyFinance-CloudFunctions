# Outflow Summary System Implementation Plan

**Plan Name:** Outflow Period Summary System for Dashboard Optimization
**Date:** November 24, 2025
**Status:** Planning - Pending Review
**Priority:** Phase 1 of 3 (Outflows → Budgets → Inflows)

---

## Overview

Implement an Outflow-specific Period Summary System to optimize dashboard loading by aggregating outflow period data into summary documents, reducing reads from 100+ documents to 1 per period type.

This is the **first phase** of the complete Period Summary System. Once outflows are working smoothly, the same pattern will be applied to budgets and inflows.

## Requirements Summary

- **Scope**: Outflows only (recurring bills and expenses)
- **Frequencies**: Monthly, weekly, bi-weekly
- **Owners**: Both user-level and group-level summaries
- **Time Window**: 1 year backward + 1 year forward (24 months)
- **Update Strategy**: Real-time triggers on outflow_period changes
- **Document Pattern**: `outflowSummaries/{ownerId|groupId}_{periodType}`

## Data Size Estimates

- Monthly (24 periods): ~3.4 KB per summary
- Weekly (104 periods): ~14.6 KB per summary
- Bi-weekly (52 periods): ~7.3 KB per summary
- Total per user (3 outflow summaries): ~25 KB
- **Performance**: 99% reduction in read operations for outflow data

## Architecture

### Document Structure

**Collections (Two Separate Root Collections):**
- `outflowSummaries/` - User-level outflow summaries (root collection)
- `groupOutflowSummaries/` - Group-level outflow summaries (root collection)

**Collection Initialization:**
- Both collections are created automatically when a user first authenticates
- Triggered by `onUserCreated` Cloud Function listening to `users/{userId}` document creation
- If collections already exist, no action is taken (idempotent)
- Each collection starts with 3 empty summary documents per user/group (monthly, weekly, biweekly)

**Document ID Pattern:**
- User summaries: `{userId}_{periodType}` (e.g., `user_abc123_monthly`)
- Group summaries: `{groupId}_{periodType}` (e.g., `group_xyz789_monthly`)

**Period Organization Strategy:**
- The `periods` array within each document is organized/sorted by `sourcePeriodId`
- This makes it easier for the frontend to sum, group, and filter periods by source
- Each user/group has 3 summary documents (1 per period type: monthly, weekly, biweekly)
- Example: User has 3 docs: `userId_monthly`, `userId_weekly`, `userId_biweekly`

**Outflow Summary Document Schema:**
```typescript
interface OutflowPeriodSummary {
  // Identity
  ownerId: string;              // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: 'MONTHLY' | 'WEEKLY' | 'BI_MONTHLY';
  resourceType: 'outflow';      // Always 'outflow'

  // Time Window
  windowStart: Timestamp;       // Start of 2-year window
  windowEnd: Timestamp;         // End of 2-year window

  // Summary Data
  periods: OutflowPeriodEntry[];  // Array of period summaries

  // Metadata
  totalItemCount: number;       // Total active outflows being tracked
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Outflow Period Entry Schema:**
```typescript
interface OutflowPeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01" (sourcePeriodId)
  groupId: string;                   // Group ID for this period
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure)
  totalAmountDue: number;            // Total expected for this period
  totalAmountPaid: number;           // Total actually paid
  totalAmountUnpaid: number;         // Remaining balance
  totalAmountWithheld: number;       // Total amount being withheld for bills
  averageAmount: number;             // Average outflow amount for this period

  // Due Status
  isDuePeriod: boolean;              // Is this period currently due
  duePeriodCount: number;            // How many outflows are due this period

  // Merchant Information
  merchantBreakdown: MerchantSummary[];  // Top merchants for this period

  // Status Breakdown
  statusCounts: {
    PAID: number;
    OVERDUE: number;
    DUE_SOON: number;
    PENDING: number;
    PARTIAL: number;
    NOT_DUE: number;
  };

  // Progress Metrics
  paymentProgressPercentage: number; // (paid / due) × 100
  fullyPaidCount: number;            // Outflows fully paid
  unpaidCount: number;               // Outflows not paid
  itemCount: number;                 // Total outflows with periods in this range
}

interface MerchantSummary {
  merchant: string;                  // Merchant name
  count: number;                     // Number of outflows to this merchant
  totalAmount: number;               // Total amount for this merchant
}
```

## Implementation Phases

### Phase 1: Type Definitions & Infrastructure

**New File:** `/src/types/outflowSummaries.ts`

Following existing type patterns from `/src/types/index.ts`:

```typescript
import { Timestamp } from "firebase-admin/firestore";
import { PeriodType } from "./index";

/**
 * Merchant summary for a period
 */
export interface MerchantSummary {
  merchant: string;              // Merchant/vendor name
  count: number;                 // Number of outflows to this merchant
  totalAmount: number;           // Total amount for this merchant
}

/**
 * Single outflow period's aggregated summary data
 */
export interface OutflowPeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01"
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure, NOT nested)
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;
  totalAmountWithheld: number;       // NEW: Total withheld for bills
  averageAmount: number;             // NEW: Average outflow amount

  // Due Status (NEW)
  isDuePeriod: boolean;              // Is this period currently due
  duePeriodCount: number;            // Count of outflows due this period

  // Merchant Information (NEW)
  merchantBreakdown: MerchantSummary[];  // Top merchants for period

  // Status Breakdown
  statusCounts: OutflowStatusCounts;

  // Progress Metrics
  paymentProgressPercentage: number; // (paid / due) × 100
  fullyPaidCount: number;
  unpaidCount: number;
  itemCount: number;                 // Items with periods in this range
}

export interface OutflowStatusCounts {
  PAID?: number;
  OVERDUE?: number;
  DUE_SOON?: number;
  PENDING?: number;
  PARTIAL?: number;
  NOT_DUE?: number;
}

/**
 * Outflow period summary document structure
 */
export interface OutflowPeriodSummary {
  // Identity
  ownerId: string;                   // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: PeriodType;            // MONTHLY, WEEKLY, BI_MONTHLY
  resourceType: 'outflow';

  // Time Window
  windowStart: Timestamp;            // Start of 2-year window
  windowEnd: Timestamp;              // End of 2-year window

  // Summary Data
  periods: OutflowPeriodEntry[];     // Array of period summaries

  // Metadata
  totalItemCount: number;            // Total active outflows
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Modify:** `/src/types/index.ts`
```typescript
// Add to exports
export * from "./outflowSummaries";
```

**New File:** `/src/functions/auth/orchestration/triggers/onUserCreate.ts`

**Purpose:** Initialize outflow summary collections when a user authenticates for the first time

```typescript
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeOutflowSummaries, initializeGroupOutflowSummaries } from '../../utils/initializeOutflowSummaries';

export const onUserCreated = onDocumentCreated({
  document: 'users/{userId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  const userId = event.params.userId;
  const userData = event.data?.data();

  console.log(`🆕 New user created: ${userId}`);

  // Initialize user outflow summary collections
  await initializeOutflowSummaries(userId);

  // Initialize group outflow summaries if user belongs to groups
  if (userData?.groupIds && userData.groupIds.length > 0) {
    for (const groupId of userData.groupIds) {
      await initializeGroupOutflowSummaries(groupId);
    }
  }
});
```

**New File:** `/src/functions/auth/utils/initializeOutflowSummaries.ts`

**Purpose:** Create empty outflow summary documents for a new user or group

```typescript
import * as admin from 'firebase-admin';
import { PeriodType } from '../../../types';

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

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

    // Check if document already exists (idempotent)
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

    // Check if document already exists (idempotent)
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
```

**Modify:** `/firestore.rules`

Following existing security rule patterns:

```javascript
// User Outflow Summary Collections
match /outflowSummaries/{summaryId} {
  // Read: User's own summary
  allow read: if isAuthenticated() &&
                 summaryId.matches('^' + request.auth.uid + '_.*');

  // Write: Cloud Functions only
  allow create, update, delete: if false;
}

// Group Outflow Summary Collections (separate root collection)
match /groupOutflowSummaries/{summaryId} {
  // Read: Group summary if user belongs to group
  allow read: if isAuthenticated() &&
                 userBelongsToGroupFromSummaryId(summaryId);

  // Write: Cloud Functions only
  allow create, update, delete: if false;
}

// Helper function
function userBelongsToGroupFromSummaryId(summaryId) {
  // Extract groupId from summaryId (format: groupId_periodType)
  let groupId = summaryId.split('_')[0];
  let userDoc = get(/databases/$(database)/documents/users/$(request.auth.uid));
  return userDoc.data.groupIds.hasAny([groupId]);
}
```

**Modify:** `/firestore.indexes.json`

Add to existing indexes array:

```json
{
  "collectionGroup": "outflow_periods",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "periodType", "order": "ASCENDING" },
    { "fieldPath": "periodStartDate", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "outflow_periods",
  "fields": [
    { "fieldPath": "groupId", "order": "ASCENDING" },
    { "fieldPath": "periodType", "order": "ASCENDING" },
    { "fieldPath": "periodStartDate", "order": "ASCENDING" }
  ]
}
```

### Phase 2: Core Utilities

**New File:** `/src/functions/outflows/utils/calculateOutflowPeriodSummary.ts`

Following patterns from `/src/functions/budgets/utils/budgetSpending.ts`:

```typescript
import * as admin from 'firebase-admin';
import { OutflowPeriodEntry, OutflowStatusCounts, MerchantSummary } from '../../../types/outflowSummaries';
import { PeriodType } from '../../../types';

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

/**
 * Calculate outflow period summary for a specific owner
 * Pattern matches budgetSpending.ts aggregation approach
 */
export async function calculateOutflowPeriodSummary(
  ownerId: string,
  ownerType: 'user' | 'group',
  periodType: PeriodType
): Promise<OutflowPeriodEntry[]> {
  console.log(`📊 Calculating outflow period summary:`, {
    ownerId,
    ownerType,
    periodType
  });

  // Calculate 2-year window
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setFullYear(now.getFullYear() - 1);
  const windowEnd = new Date(now);
  windowEnd.setFullYear(now.getFullYear() + 1);

  const windowStartTs = Timestamp.fromDate(windowStart);
  const windowEndTs = Timestamp.fromDate(windowEnd);

  console.log(`📊 Window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

  // Query all outflow periods in window
  const ownerField = ownerType === 'user' ? 'userId' : 'groupId';

  const periodsQuery = db.collection('outflow_periods')
    .where(ownerField, '==', ownerId)
    .where('periodType', '==', periodType)
    .where('periodStartDate', '>=', windowStartTs)
    .where('periodStartDate', '<=', windowEndTs)
    .where('isActive', '==', true);

  const periodsSnapshot = await periodsQuery.get();

  console.log(`📊 Found ${periodsSnapshot.size} outflow periods in window`);

  if (periodsSnapshot.empty) {
    return [];
  }

  // Group periods by sourcePeriodId for organization
  const periodGroups = new Map<string, any[]>();

  periodsSnapshot.forEach(doc => {
    const periodData = doc.data();
    const periodId = periodData.sourcePeriodId || periodData.periodId;

    if (!periodGroups.has(periodId)) {
      periodGroups.set(periodId, []);
    }

    periodGroups.get(periodId)!.push({ id: doc.id, ...periodData });
  });

  console.log(`📊 Grouped into ${periodGroups.size} unique periods by sourcePeriodId`);

  // Calculate entry for each period
  const periodEntries: OutflowPeriodEntry[] = [];

  for (const [periodId, periodDocs] of periodGroups) {
    const entry = calculateOutflowPeriodEntry(periodDocs);
    periodEntries.push(entry);
  }

  // Sort chronologically
  periodEntries.sort((a, b) =>
    a.periodStartDate.toMillis() - b.periodStartDate.toMillis()
  );

  console.log(`✅ Calculated ${periodEntries.length} outflow period entries`);

  return periodEntries;
}

/**
 * Calculate single outflow period entry from multiple period documents
 * Aggregates amounts, statuses, merchants across all outflows in the period
 * Extracts groupId from period documents for period entry
 */
function calculateOutflowPeriodEntry(
  periodDocs: any[]
): OutflowPeriodEntry {
  const firstDoc = periodDocs[0];
  const periodId = firstDoc.sourcePeriodId || firstDoc.periodId;
  const groupId = firstDoc.groupId || '';  // Extract groupId from period
  const now = new Date();

  // Initialize aggregates
  let totalAmountDue = 0;
  let totalAmountPaid = 0;
  let totalAmountWithheld = 0;
  let fullyPaidCount = 0;
  let unpaidCount = 0;
  let duePeriodCount = 0;
  const statusCounts: OutflowStatusCounts = {};
  const merchantTotals = new Map<string, { count: number; total: number }>();
  const amounts: number[] = [];

  // Aggregate across all period documents
  for (const doc of periodDocs) {
    // Amounts
    const amountDue = doc.totalAmountDue || doc.amountDue || 0;
    totalAmountDue += amountDue;
    totalAmountPaid += doc.totalAmountPaid || 0;
    totalAmountWithheld += doc.amountWithheld || 0;
    amounts.push(amountDue);

    // Status counts
    const status = doc.status;
    if (status) {
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    // Paid vs unpaid tracking
    if (doc.isFullyPaid || doc.isPaid) {
      fullyPaidCount++;
    } else {
      unpaidCount++;
    }

    // Due period tracking
    if (doc.isDuePeriod) {
      duePeriodCount++;
    }

    // Merchant aggregation
    const merchant = doc.merchant || doc.merchantName || 'Unknown';
    if (!merchantTotals.has(merchant)) {
      merchantTotals.set(merchant, { count: 0, total: 0 });
    }
    const merchantData = merchantTotals.get(merchant)!;
    merchantData.count++;
    merchantData.total += amountDue;
  }

  // Calculate derived values
  const totalAmountUnpaid = totalAmountDue - totalAmountPaid;
  const paymentProgressPercentage = totalAmountDue > 0
    ? Math.round((totalAmountPaid / totalAmountDue) * 100)
    : 0;

  // Calculate average amount
  const averageAmount = amounts.length > 0
    ? amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length
    : 0;

  // Determine if this is a due period
  const isDuePeriod = duePeriodCount > 0 ||
                      (firstDoc.periodStartDate.toMillis() <= now.getTime() &&
                       firstDoc.periodEndDate.toMillis() >= now.getTime());

  // Build merchant breakdown (top 5 merchants)
  const merchantBreakdown: MerchantSummary[] = Array.from(merchantTotals.entries())
    .map(([merchant, data]) => ({
      merchant,
      count: data.count,
      totalAmount: data.total
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 5);

  return {
    periodId,
    groupId,  // Include groupId in period entry
    periodStartDate: firstDoc.periodStartDate,
    periodEndDate: firstDoc.periodEndDate,
    totalAmountDue,
    totalAmountPaid,
    totalAmountUnpaid,
    totalAmountWithheld,
    averageAmount,
    isDuePeriod,
    duePeriodCount,
    merchantBreakdown,
    statusCounts,
    paymentProgressPercentage,
    fullyPaidCount,
    unpaidCount,
    itemCount: periodDocs.length
  };
}
```

**New File:** `/src/functions/outflows/utils/updateOutflowPeriodSummary.ts`

**Key Function:** `updateOutflowPeriodSummary()`
- **Input**: periodChange (old and new outflow_period data)
- **Process**:
  1. Extract ownerId, periodType, sourcePeriodId from period
  2. Determine if user summary and/or group summary need updates
  3. For each affected summary (outflowSummaries and groupOutflowSummaries):
     - Fetch existing summary document
     - If doesn't exist, call full recalculation
     - Find affected period entry in summary by sourcePeriodId
     - Recalculate that single entry from all periods with same sourcePeriodId
     - Update summary document atomically (maintains sourcePeriodId ordering)
- **Output**: Updated summary documents in both collections as needed

**Trigger Handling:**
- **onCreate**: Add new period to summary (organized by sourcePeriodId)
- **onUpdate**: Recalculate affected period entry
- **onDelete**: Recalculate (may remove entry if last period for that sourcePeriodId)

**New File:** `/src/functions/outflows/utils/updateOutflowSummary.ts`

**Key Function:** `updateOutflowSummary()` - Batched Update Manager

**Purpose**: Prevents hitting Firestore's write rate limits by batching multiple summary updates together.

**Problem Statement**:
Firestore has a limit of ~1 write per second to a single document. If multiple outflow_periods are created/updated rapidly (e.g., during bulk import or sync), individual `updateOutflowPeriodSummary()` calls could exceed this limit and cause contention errors.

**Solution**:
The `updateOutflowSummary()` function acts as a batching layer that:
1. Accumulates pending updates for the same summary document
2. Debounces rapid updates (waits for quiet period)
3. Executes a single batched write with all accumulated changes

**Implementation**:

```typescript
import * as admin from 'firebase-admin';
import { OutflowPeriodEntry } from '../../../types/outflowSummaries';

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

// In-memory update queue (per Cloud Function instance)
const updateQueue = new Map<string, {
  updates: Set<string>,  // Set of sourcePeriodIds that need recalculation
  timeout: NodeJS.Timeout | null,
  lastUpdate: number
}>();

const BATCH_DELAY_MS = 2000;  // Wait 2 seconds for more updates
const MAX_WAIT_MS = 10000;    // Force update after 10 seconds max

/**
 * Queue a summary update with automatic batching
 * Multiple rapid calls for the same summary are combined into one write
 */
export async function updateOutflowSummary(
  summaryDocPath: string,      // e.g., "outflowSummaries/user123_monthly"
  sourcePeriodId: string,       // Which period needs recalculation
  force: boolean = false         // Force immediate update (bypass batching)
): Promise<void> {

  if (force) {
    // Skip batching, update immediately
    await performSummaryUpdate(summaryDocPath, new Set([sourcePeriodId]));
    return;
  }

  // Get or create queue entry for this summary
  let queueEntry = updateQueue.get(summaryDocPath);

  if (!queueEntry) {
    queueEntry = {
      updates: new Set<string>(),
      timeout: null,
      lastUpdate: Date.now()
    };
    updateQueue.set(summaryDocPath, queueEntry);
  }

  // Add this sourcePeriodId to pending updates
  queueEntry.updates.add(sourcePeriodId);

  // Clear existing timeout
  if (queueEntry.timeout) {
    clearTimeout(queueEntry.timeout);
  }

  // Check if we've been waiting too long
  const waitTime = Date.now() - queueEntry.lastUpdate;
  const shouldForceUpdate = waitTime > MAX_WAIT_MS;

  if (shouldForceUpdate) {
    // Force update now, we've waited long enough
    console.log(`⏰ Forcing update for ${summaryDocPath} after ${waitTime}ms`);
    await performSummaryUpdate(summaryDocPath, queueEntry.updates);
    updateQueue.delete(summaryDocPath);
  } else {
    // Set new timeout to batch more updates
    queueEntry.timeout = setTimeout(async () => {
      console.log(`📦 Batching ${queueEntry!.updates.size} updates for ${summaryDocPath}`);
      await performSummaryUpdate(summaryDocPath, queueEntry!.updates);
      updateQueue.delete(summaryDocPath);
    }, BATCH_DELAY_MS);
  }
}

/**
 * Perform the actual summary update with all accumulated changes
 */
async function performSummaryUpdate(
  summaryDocPath: string,
  sourcePeriodIds: Set<string>
): Promise<void> {
  const startTime = Date.now();
  console.log(`🔄 Updating ${summaryDocPath} with ${sourcePeriodIds.size} period(s)`);

  try {
    // Parse the document path
    const [collectionName, docId] = summaryDocPath.split('/');
    const [ownerId, periodTypeStr] = docId.split('_');
    const periodType = periodTypeStr.toUpperCase() as PeriodType;
    const ownerType = collectionName === 'outflowSummaries' ? 'user' : 'group';

    // Fetch the current summary document
    const summaryRef = db.doc(summaryDocPath);
    const summarySnap = await summaryRef.get();

    if (!summarySnap.exists) {
      console.warn(`⚠️ Summary document does not exist: ${summaryDocPath}`);
      // Could call full recalculation here if needed
      return;
    }

    const summaryData = summarySnap.data()!;
    const existingPeriods = summaryData.periods || [];

    // Recalculate each affected sourcePeriodId
    const updatedPeriodMap = new Map<string, OutflowPeriodEntry>();

    // Keep existing periods that aren't being updated
    existingPeriods.forEach((period: OutflowPeriodEntry) => {
      if (!sourcePeriodIds.has(period.periodId)) {
        updatedPeriodMap.set(period.periodId, period);
      }
    });

    // Recalculate the periods that need updating
    for (const sourcePeriodId of sourcePeriodIds) {
      const recalculatedEntry = await recalculatePeriodEntry(
        ownerId,
        ownerType,
        periodType,
        sourcePeriodId
      );

      if (recalculatedEntry) {
        updatedPeriodMap.set(sourcePeriodId, recalculatedEntry);
      }
      // If null, period was deleted and should be removed from summary
    }

    // Convert map to sorted array by sourcePeriodId
    const updatedPeriods = Array.from(updatedPeriodMap.values())
      .sort((a, b) => a.periodStartDate.toMillis() - b.periodStartDate.toMillis());

    // Single atomic write
    await summaryRef.update({
      periods: updatedPeriods,
      lastRecalculated: Timestamp.now(),
      updatedAt: Timestamp.now(),
      totalItemCount: updatedPeriods.length
    });

    const duration = Date.now() - startTime;
    console.log(`✅ Updated ${summaryDocPath} in ${duration}ms`);

  } catch (error) {
    console.error(`❌ Error updating ${summaryDocPath}:`, error);
    throw error;
  }
}

/**
 * Recalculate a single period entry by querying all outflow_periods
 * with the same sourcePeriodId
 */
async function recalculatePeriodEntry(
  ownerId: string,
  ownerType: 'user' | 'group',
  periodType: PeriodType,
  sourcePeriodId: string
): Promise<OutflowPeriodEntry | null> {

  const ownerField = ownerType === 'user' ? 'userId' : 'groupId';

  const periodsQuery = await db.collection('outflow_periods')
    .where(ownerField, '==', ownerId)
    .where('periodType', '==', periodType)
    .where('sourcePeriodId', '==', sourcePeriodId)
    .where('isActive', '==', true)
    .get();

  if (periodsQuery.empty) {
    // No periods left for this sourcePeriodId, return null to remove entry
    return null;
  }

  // Use existing calculateOutflowPeriodEntry logic
  const periodDocs = periodsQuery.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return calculateOutflowPeriodEntry(periodDocs);
}
```

**Usage in Triggers**:

```typescript
// In onOutflowPeriodCreatedSummary
export const onOutflowPeriodCreatedSummary = onDocumentCreated({
  document: 'outflow_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  const periodData = event.data?.data();
  if (!periodData) return;

  const sourcePeriodId = periodData.sourcePeriodId || periodData.periodId;
  const userId = periodData.userId;
  const groupId = periodData.groupId;
  const periodType = periodData.periodType.toLowerCase();

  // Queue updates with batching
  await updateOutflowSummary(
    `outflowSummaries/${userId}_${periodType}`,
    sourcePeriodId
  );

  if (groupId) {
    await updateOutflowSummary(
      `groupOutflowSummaries/${groupId}_${periodType}`,
      sourcePeriodId
    );
  }
});
```

**Benefits**:
1. **Prevents Contention**: Multiple rapid changes are combined into one write
2. **Cost Optimization**: Fewer writes = lower Firestore costs
3. **Better Performance**: Reduces function execution time during bulk operations
4. **Automatic Batching**: No manual coordination needed, happens transparently
5. **Configurable Timing**: Can adjust `BATCH_DELAY_MS` and `MAX_WAIT_MS` as needed

**Tradeoffs**:
- **Slight Delay**: Updates may take up to 2 seconds (vs immediate)
- **Memory Usage**: In-memory queue (minimal, cleared after updates)
- **Cold Start**: Queue is per-instance, resets on cold starts (acceptable)

### Phase 3: Trigger Implementation

## Automatic Summary Update Triggers

The outflow summary system uses real-time Firestore triggers to keep summaries up-to-date automatically. When any change occurs to an `outflow_periods` document, the corresponding summary documents are updated immediately.

### Trigger Events and Processing

**1. When an Outflow Period is Created (`onCreate`)**
- **Trigger**: New document created in `outflow_periods` collection
- **Processing**:
  1. Extract `sourcePeriodId` (or fallback to `periodId`) from the new period
  2. Extract `userId` and `groupId` to determine which summaries need updates
  3. Fetch existing summary documents:
     - User summary: `outflowSummaries/{userId}_{periodType}`
     - Group summary: `groupOutflowSummaries/{groupId}_{periodType}` (if groupId exists)
  4. Find or create the period entry matching the `sourcePeriodId` in the summary's `periods` array
  5. Recalculate aggregated values (totals, counts, merchant breakdown) for that `sourcePeriodId`
  6. Update both summary documents atomically
  7. **Maintain sourcePeriodId organization**: Periods array remains sorted by sourcePeriodId

**2. When an Outflow Period is Updated (`onUpdate`)**
- **Trigger**: Existing document in `outflow_periods` modified
- **Processing**:
  1. Extract `sourcePeriodId` from the updated period
  2. Identify affected summaries (user and/or group)
  3. Locate the specific period entry by `sourcePeriodId` in the summary's `periods` array
  4. Recalculate only that period entry by re-aggregating all outflow_periods with the same `sourcePeriodId`
  5. Update summary documents with new aggregated values
  6. **Preserve sourcePeriodId grouping**: All periods with the same sourcePeriodId are always aggregated together

**3. When an Outflow Period is Deleted (`onDelete`)**
- **Trigger**: Document deleted from `outflow_periods` collection
- **Processing**:
  1. Extract `sourcePeriodId` from the deleted period
  2. Identify affected summaries
  3. Query remaining outflow_periods with the same `sourcePeriodId`
  4. If other periods exist with this sourcePeriodId: Recalculate the period entry
  5. If no other periods exist: Remove the period entry from the summary's `periods` array
  6. Update summary documents

### SourcePeriodId Grouping Logic

**Key Principle**: All outflow_periods that share the same `sourcePeriodId` are aggregated into a single period entry in the summary.

**Example Scenario**:
```
Outflow_periods collection:
- doc1: { sourcePeriodId: "2025M01", userId: "user123", outflowId: "rent", amount: 1000 }
- doc2: { sourcePeriodId: "2025M01", userId: "user123", outflowId: "utilities", amount: 200 }
- doc3: { sourcePeriodId: "2025M02", userId: "user123", outflowId: "rent", amount: 1000 }

Summary document (outflowSummaries/user123_monthly):
periods: [
  {
    periodId: "2025M01",  // sourcePeriodId
    groupId: "...",
    totalAmountDue: 1200,  // rent + utilities
    itemCount: 2,
    merchantBreakdown: [
      { merchant: "Landlord", count: 1, totalAmount: 1000 },
      { merchant: "Power Company", count: 1, totalAmount: 200 }
    ]
  },
  {
    periodId: "2025M02",  // sourcePeriodId
    groupId: "...",
    totalAmountDue: 1000,  // rent only
    itemCount: 1,
    ...
  }
]
```

**When doc1 is updated**:
- Trigger extracts `sourcePeriodId: "2025M01"`
- Finds the period entry with `periodId: "2025M01"` in summary
- Re-queries ALL outflow_periods with `sourcePeriodId: "2025M01"` (doc1 + doc2)
- Recalculates aggregated totals for that entry
- Updates only that period entry in the summary

### Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Outflow Period Change                         │
│          (Create / Update / Delete in outflow_periods)           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Firestore Trigger (onCreate/onUpdate/onDelete)      │
│                                                                   │
│  1. Extract sourcePeriodId, userId, groupId from period doc     │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Identify Affected Summaries                     │
│                                                                   │
│  • User Summary:  outflowSummaries/{userId}_{periodType}        │
│  • Group Summary: groupOutflowSummaries/{groupId}_{periodType}  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Query All Periods with Same SourcePeriodId          │
│                                                                   │
│  db.collection('outflow_periods')                                │
│    .where('userId', '==', userId)                                │
│    .where('sourcePeriodId', '==', sourcePeriodId)                │
│    .where('periodType', '==', periodType)                        │
│    .get()                                                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│            Aggregate Data by SourcePeriodId                      │
│                                                                   │
│  • Sum amounts (due, paid, withheld)                            │
│  • Count statuses (paid, overdue, pending)                      │
│  • Calculate merchant breakdown (top 5)                         │
│  • Compute averages and percentages                             │
│  • Extract groupId from periods                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Update Summary Documents (Atomic)                   │
│                                                                   │
│  1. Find/create period entry with matching sourcePeriodId       │
│  2. Replace aggregated values for that entry                    │
│  3. Maintain periods array sorted by sourcePeriodId             │
│  4. Update lastRecalculated timestamp                           │
│  5. Write to both user and group summaries                      │
└─────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Summaries Up-to-Date                         │
│                                                                   │
│  • Dashboard reads 1 document instead of 100+                   │
│  • Periods organized by sourcePeriodId for easy filtering       │
│  • Real-time updates (<5 seconds)                               │
└─────────────────────────────────────────────────────────────────┘
```

### Key Points About Automatic Updates

1. **Real-time Processing**: Updates happen within seconds of any outflow_period change
2. **Incremental Updates**: Only the affected sourcePeriodId entry is recalculated, not the entire summary
3. **Dual Collection Updates**: Both user and group summaries are updated in parallel
4. **Idempotent Operations**: Trigger can be retried safely without causing duplicates
5. **Maintains Organization**: Periods array always stays sorted by sourcePeriodId after updates
6. **Handles All Cases**:
   - First period for a sourcePeriodId → Creates new entry
   - Additional period for existing sourcePeriodId → Updates existing entry
   - Last period deleted for a sourcePeriodId → Removes entry from summary

### Trigger Implementation

**New File:** `/src/functions/outflows/orchestration/triggers/onOutflowPeriodSummary.ts`

```typescript
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { updateOutflowPeriodSummary } from '../../utils/updateOutflowPeriodSummary';

export const onOutflowPeriodCreatedSummary = onDocumentCreated({
  document: 'outflow_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateOutflowPeriodSummary(null, event.data);
});

export const onOutflowPeriodUpdatedSummary = onDocumentUpdated({
  document: 'outflow_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateOutflowPeriodSummary(event.data.before, event.data.after);
});

export const onOutflowPeriodDeletedSummary = onDocumentDeleted({
  document: 'outflow_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateOutflowPeriodSummary(event.data, null);
});
```

**Modify:** `/src/functions/outflows/orchestration/triggers/index.ts`
- Export new triggers

### Phase 4: Callable Functions

**New File:** `/src/functions/outflows/api/recalculateOutflowSummary.ts`

**Function:** `recalculateOutflowSummary` (Callable)
- **Purpose**: Manual recalculation for backfill/debugging
- **Parameters**:
  - `ownerId`: User ID or Group ID
  - `ownerType`: 'user' | 'group'
  - `periodType`: 'MONTHLY' | 'WEEKLY' | 'BI_MONTHLY'
- **Authorization**: Users can only recalculate their own summaries
- **Process**:
  1. Validate authorization
  2. Call `calculateOutflowPeriodSummary()` to get fresh data
  3. Create or update summary document
  4. Return success with summary stats
- **Use Cases**:
  - Initial data population for existing users
  - Fixing inconsistencies
  - After data migrations

**Modify:** `/src/index.ts`
- Export callable function

### Phase 5: Migration & Data Population

**Step 1: Deploy Infrastructure**
1. Deploy type definitions
2. Deploy security rules
3. Deploy indexes
4. Wait for index builds to complete

**Step 2: Deploy Core Logic**
1. Deploy utility functions
2. Deploy callable function
3. Test with single user's data

**Step 3: Deploy Triggers**
1. Deploy outflow period triggers
2. Monitor for 24-48 hours
3. Verify summaries update correctly

**Step 4: Backfill Existing Data**
1. Create admin script to call `recalculateOutflowSummary` for all users
2. Process in batches (100 users at a time)
3. Monitor Firestore usage and function execution
4. Validate sample summaries manually

**Step 5: Frontend Integration**
1. Update mobile app to query outflow summaries instead of periods
2. Display aggregated metrics in dashboard
3. Load full periods only when tiles clicked

## Security Rules

```javascript
// Outflow summary collections: Read-only for users, write-only for Cloud Functions
match /outflowSummaries/{summaryId} {
  // Read: User's own summary
  allow read: if isAuthenticated() &&
                 summaryId.matches('^' + request.auth.uid + '_.*');

  // Read: Group summary if user belongs to group
  allow read: if isAuthenticated() &&
                 resource.data.ownerType == 'group' &&
                 userBelongsToGroup(resource.data.ownerId);

  // Write: Cloud Functions only
  allow create, update, delete: if false;
}

// Helper function
function userBelongsToGroup(groupId) {
  let userDoc = get(/databases/$(database)/documents/users/$(request.auth.uid));
  return userDoc.data.groupIds.hasAny([groupId]);
}
```

## Firestore Indexes

```json
{
  "indexes": [
    {
      "collectionGroup": "outflow_periods",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "periodType", "order": "ASCENDING" },
        { "fieldPath": "periodStartDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "outflow_periods",
      "fields": [
        { "fieldPath": "groupId", "order": "ASCENDING" },
        { "fieldPath": "periodType", "order": "ASCENDING" },
        { "fieldPath": "periodStartDate", "order": "ASCENDING" }
      ]
    }
  ]
}
```

## Testing Strategy

### Unit Tests

**Test File:** `/src/functions/outflows/utils/__tests__/calculateOutflowPeriodSummary.test.ts`
- Test period entry aggregation with multiple outflow periods
- Test status counting accuracy
- Test progress percentage calculations
- Test merchant aggregation (top 5)
- Test isDuePeriod detection
- Test amountWithheld totaling
- Test averageAmount calculation
- Test empty period handling

**Test File:** `/src/functions/outflows/utils/__tests__/updateOutflowPeriodSummary.test.ts`
- Test incremental updates on onCreate
- Test incremental updates on onUpdate
- Test period removal on onDelete
- Test fallback to full recalculation

### Integration Tests
- Create outflow_period → verify summary updates within seconds
- Update period status → verify entry recalculation
- Delete outflow period → verify entry removal or recalculation
- Update merchant → verify merchantBreakdown updates

### Manual Testing Checklist
1. Create new outflow with periods → summary auto-created
2. Mark period as paid → summary updates status counts
3. Delete outflow period → summary reflects change
4. Share outflow with group → group summary created
5. Verify merchant breakdown shows correct top merchants
6. Verify isDuePeriod flag is accurate for current date
7. Verify document sizes under limits

## Performance Considerations

**Before (Current System):**
- Dashboard load: Query 100+ outflow_period documents
- Network: ~100 reads × 1 KB = ~100 KB
- Cost: 100 reads per dashboard load

**After (With Summaries):**
- Dashboard load: Query 1 outflow summary document
- Network: 1 read × 15 KB = ~15 KB
- Cost: 1 read per dashboard load
- **Savings: 99% reduction in reads**

**Write Impact:**
- +1-2 writes per period change (user + group summaries)
- Triggers are async (no user-facing latency)
- Incremental updates minimize computation

**Scalability:**
- Maximum 104 periods (weekly) × ~180 bytes = ~19 KB
- Well under 1 MB Firestore document limit
- Supports up to 100 outflows per user without issues
- Merchant breakdown limited to top 5 to control size

## Files Summary

### New Files (10 total)
1. `/src/types/outflowSummaries.ts` - Type definitions (includes groupId in PeriodEntry)
2. `/src/functions/auth/orchestration/triggers/onUserCreate.ts` - User authentication trigger
3. `/src/functions/auth/utils/initializeOutflowSummaries.ts` - Summary initialization utilities (both collections)
4. `/src/functions/outflows/utils/calculateOutflowPeriodSummary.ts` - Full calculation (organizes by sourcePeriodId)
5. `/src/functions/outflows/utils/updateOutflowPeriodSummary.ts` - Incremental updates (both collections)
6. `/src/functions/outflows/utils/updateOutflowSummary.ts` - **NEW: Batched update manager (prevents write contention)**
7. `/src/functions/outflows/api/recalculateOutflowSummary.ts` - Callable function
8. `/src/functions/outflows/orchestration/triggers/onOutflowPeriodSummary.ts` - Outflow period triggers (uses batching)
9. `/src/functions/outflows/utils/__tests__/calculateOutflowPeriodSummary.test.ts` - Unit tests
10. `/src/functions/outflows/utils/__tests__/updateOutflowPeriodSummary.test.ts` - Unit tests

### Modified Files (5 total)
1. `/src/types/index.ts` - Export new outflowSummaries types
2. `/src/index.ts` - Export callable function
3. `/firestore.rules` - Add outflowSummaries AND groupOutflowSummaries collection rules
4. `/firestore.indexes.json` - Add composite indexes for outflow_periods
5. `/src/functions/outflows/orchestration/triggers/index.ts` - Export new triggers

## Success Criteria

1. **Collection Initialization**: Empty summary documents created automatically for new users in BOTH collections (outflowSummaries and groupOutflowSummaries)
2. **Real-time Updates**: Summaries update in real-time (<5 seconds) when outflow_periods change
3. **Performance**: Dashboard loads with 1 read instead of 100+ (99% reduction)
4. **Document Size**: Document sizes remain under 20 KB (well under 1 MB limit)
5. **Group Summaries**: Group summaries aggregate correctly across all members in separate collection
6. **SourcePeriodId Organization**: Periods array is organized/sorted by sourcePeriodId for frontend convenience
7. **GroupId Field**: Each period entry includes groupId field
8. **Merchant Breakdown**: Top 5 merchants accurately calculated per period
9. **Due Period Detection**: isDuePeriod flag accurately reflects current period status
10. **Amount Calculations**: amountWithheld and averageAmount calculate correctly
11. **Backfill Success**: All existing outflow period data backfilled successfully

## Risk Mitigation

**Risk**: Firestore document size limit exceeded
- **Mitigation**: Current calculations show max 19 KB (well under 1 MB)
- **Mitigation**: Merchant breakdown limited to top 5
- **Monitoring**: Track document sizes in production

**Risk**: Trigger failures causing inconsistent summaries
- **Mitigation**: Callable function for manual recalculation
- **Monitoring**: Cloud Function error logs

**Risk**: High write costs from frequent updates
- **Mitigation**: Incremental updates only affect single period entry
- **Optimization**: Batch multiple changes if needed

**Risk**: Merchant aggregation performance
- **Mitigation**: Limited to top 5 merchants per period
- **Optimization**: Use Map for efficient aggregation

## Key Design Decisions

### Two Separate Root Collections
- **Rationale**: Separate `outflowSummaries` and `groupOutflowSummaries` collections simplify security rules and queries
- **Benefit**: Clear separation between user-owned and group-shared summaries
- **Alternative Considered**: Single collection with mixed user/group documents (rejected for security rule complexity)

### Authentication-Based Initialization
- **Rationale**: Creating empty summaries on user authentication ensures they're always available
- **Trigger**: `onUserCreated` Cloud Function listens to `users/{userId}` document creation
- **Benefit**: No "summary not found" errors, summaries grow incrementally as data is added
- **Idempotent**: Checks for existing documents before creating new ones

### SourcePeriodId Organization
- **Rationale**: Frontend can efficiently filter and sum periods without additional processing
- **Implementation**: Periods array sorted by sourcePeriodId in calculateOutflowPeriodSummary
- **Benefit**: Easier to group multiple outflows that share the same source period
- **Use Case**: When displaying summaries, frontend can quickly aggregate by source period

### GroupId Field in Period Entries
- **Rationale**: Each period entry includes groupId for flexible querying and filtering
- **Benefit**: Frontend can quickly identify which group a period belongs to without additional lookups
- **Implementation**: Extracted from outflow_period documents during aggregation
- **Use Case**: Filter dashboard views by group, show group-specific metrics

## Next Steps After Outflows

Once the outflow summary system is:
1. ✅ Deployed successfully
2. ✅ Tested thoroughly (collections initialized, sourcePeriodId organization verified, groupId field present)
3. ✅ Backfilled for existing users
4. ✅ Running stable for 1 week

Then proceed to **Phase 2: Budget Summary System** using the same architectural patterns (two separate collections, authentication-based initialization, sourcePeriodId organization, groupId field).

## Future Enhancements

1. **Caching**: Add client-side caching of summary documents
2. **Analytics**: Track summary usage and performance metrics
3. **Merchant Insights**: Expand merchant analytics beyond top 5
4. **Trend Detection**: Identify spending patterns across periods using sourcePeriodId grouping
5. **Historical Archives**: Move old period entries to archive collection
6. **Group Analytics**: Leverage separate groupOutflowSummaries collection for group-specific insights
