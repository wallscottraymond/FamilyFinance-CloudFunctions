# Inflow Summary System Implementation Plan

**Plan Name:** Inflow Period Summary System for Dashboard Optimization
**Date:** November 24, 2025
**Status:** Planning - Pending Review
**Priority:** Phase 3 of 3 (Outflows → Budgets → Inflows)

---

## Overview

Implement an Inflow-specific Period Summary System to optimize dashboard loading by aggregating inflow period data into summary documents, reducing reads from 100+ documents to 1 per period type.

This is the **third and final phase** of the complete Period Summary System. This will be implemented after both outflow and budget summary systems are stable and proven.

## Requirements Summary

- **Scope**: Inflows only (income and earnings tracking)
- **Frequencies**: Monthly, weekly, bi-weekly
- **Owners**: Both user-level and group-level summaries
- **Time Window**: 1 year backward + 1 year forward (24 months)
- **Update Strategy**: Real-time triggers on inflow_period changes
- **Document Pattern**: `inflowSummaries/{ownerId|groupId}_{periodType}`

## Data Size Estimates

- Monthly (24 periods): ~3.4 KB per summary
- Weekly (104 periods): ~14.6 KB per summary
- Bi-weekly (52 periods): ~7.3 KB per summary
- Total per user (3 inflow summaries): ~25 KB
- **Performance**: 99% reduction in read operations for inflow data

## Architecture

### Document Structure

**Collection:**
- `inflowSummaries/`

**Document ID Pattern:**
- User summaries: `{userId}_{periodType}` (e.g., `user_abc123_monthly`)
- Group summaries: `{groupId}_{periodType}` (e.g., `group_xyz789_monthly`)

**Inflow Summary Document Schema:**
```typescript
interface InflowPeriodSummary {
  // Identity
  ownerId: string;              // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: 'MONTHLY' | 'WEEKLY' | 'BI_MONTHLY';
  resourceType: 'inflow';       // Always 'inflow'

  // Time Window
  windowStart: Timestamp;       // Start of 2-year window
  windowEnd: Timestamp;         // End of 2-year window

  // Summary Data
  periods: InflowPeriodEntry[];   // Array of period summaries

  // Metadata
  totalItemCount: number;       // Total active inflows being tracked
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Inflow Period Entry Schema:**
```typescript
interface InflowPeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01"
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure)
  totalExpected: number;             // Total expected income
  totalReceived: number;             // Total actually received
  totalPending: number;              // Pending income
  averageAmount: number;             // Average inflow amount

  // Income Type Breakdown
  salaryCount: number;               // Regular salary inflows
  freelanceCount: number;            // Freelance/contract income
  investmentCount: number;           // Investment income
  otherCount: number;                // Other income sources

  // Source Breakdown
  sourceBreakdown: SourceSummary[];  // Top income sources

  // Status Breakdown
  statusCounts: {
    RECEIVED: number;
    PENDING: number;
    OVERDUE: number;
    PARTIAL: number;
  };

  // Progress Metrics
  receivedPercentage: number;        // (received / expected) × 100
  fullyReceivedCount: number;        // Inflows fully received
  partialReceivedCount: number;      // Inflows partially received
  itemCount: number;                 // Total inflows with periods in this range
}

interface SourceSummary {
  source: string;                    // Income source name
  count: number;                     // Number of inflows from source
  totalAmount: number;               // Total amount from source
  isRegularSalary: boolean;          // Is this regular salary
}
```

## Implementation Phases

### Phase 1: Type Definitions & Infrastructure

**New File:** `/src/types/inflowSummaries.ts`

Following existing type patterns from `/src/types/index.ts`:

```typescript
import { Timestamp } from "firebase-admin/firestore";
import { PeriodType } from "./index";

/**
 * Income source summary for a period
 */
export interface SourceSummary {
  source: string;                // Income source name/employer
  count: number;                 // Number of inflows from this source
  totalAmount: number;           // Total amount from this source
  isRegularSalary: boolean;      // Is this a regular salary source
}

/**
 * Single inflow period's aggregated summary data
 */
export interface InflowPeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01"
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure, NOT nested)
  totalExpected: number;
  totalReceived: number;
  totalPending: number;
  averageAmount: number;             // Average inflow amount

  // Income Type Breakdown
  salaryCount: number;               // Regular salary count
  freelanceCount: number;            // Freelance/contract count
  investmentCount: number;           // Investment income count
  otherCount: number;                // Other income count

  // Source Breakdown
  sourceBreakdown: SourceSummary[];  // Top income sources

  // Status Breakdown
  statusCounts: InflowStatusCounts;

  // Progress Metrics
  receivedPercentage: number;        // (received / expected) × 100
  fullyReceivedCount: number;
  partialReceivedCount: number;
  itemCount: number;                 // Items with periods in this range
}

export interface InflowStatusCounts {
  RECEIVED?: number;
  PENDING?: number;
  OVERDUE?: number;
  PARTIAL?: number;
}

/**
 * Inflow period summary document structure
 */
export interface InflowPeriodSummary {
  // Identity
  ownerId: string;                   // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: PeriodType;            // MONTHLY, WEEKLY, BI_MONTHLY
  resourceType: 'inflow';

  // Time Window
  windowStart: Timestamp;            // Start of 2-year window
  windowEnd: Timestamp;              // End of 2-year window

  // Summary Data
  periods: InflowPeriodEntry[];      // Array of period summaries

  // Metadata
  totalItemCount: number;            // Total active inflows
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Modify:** `/src/types/index.ts`
```typescript
// Add to exports
export * from "./inflowSummaries";
```

**Modify:** `/firestore.rules`

Following existing security rule patterns:

```javascript
// Inflow Summary Collections
match /inflowSummaries/{summaryId} {
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
```

**Modify:** `/firestore.indexes.json`

Add to existing indexes array:

```json
{
  "collectionGroup": "inflow_periods",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "periodType", "order": "ASCENDING" },
    { "fieldPath": "periodStartDate", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "inflow_periods",
  "fields": [
    { "fieldPath": "groupId", "order": "ASCENDING" },
    { "fieldPath": "periodType", "order": "ASCENDING" },
    { "fieldPath": "periodStartDate", "order": "ASCENDING" }
  ]
}
```

### Phase 2: Core Utilities

**New File:** `/src/functions/inflows/utils/calculateInflowPeriodSummary.ts`

Following patterns from outflow and budget implementations:

```typescript
import * as admin from 'firebase-admin';
import { InflowPeriodEntry, InflowStatusCounts, SourceSummary } from '../../../types/inflowSummaries';
import { PeriodType } from '../../../types';

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

/**
 * Calculate inflow period summary for a specific owner
 */
export async function calculateInflowPeriodSummary(
  ownerId: string,
  ownerType: 'user' | 'group',
  periodType: PeriodType
): Promise<InflowPeriodEntry[]> {
  console.log(`📊 Calculating inflow period summary:`, {
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

  // Query all inflow periods in window
  const ownerField = ownerType === 'user' ? 'userId' : 'groupId';

  const periodsQuery = db.collection('inflow_periods')
    .where(ownerField, '==', ownerId)
    .where('periodType', '==', periodType)
    .where('periodStartDate', '>=', windowStartTs)
    .where('periodStartDate', '<=', windowEndTs)
    .where('isActive', '==', true);

  const periodsSnapshot = await periodsQuery.get();

  console.log(`📊 Found ${periodsSnapshot.size} inflow periods in window`);

  if (periodsSnapshot.empty) {
    return [];
  }

  // Group periods by sourcePeriodId
  const periodGroups = new Map<string, any[]>();

  periodsSnapshot.forEach(doc => {
    const periodData = doc.data();
    const periodId = periodData.sourcePeriodId || periodData.periodId;

    if (!periodGroups.has(periodId)) {
      periodGroups.set(periodId, []);
    }

    periodGroups.get(periodId)!.push({ id: doc.id, ...periodData });
  });

  console.log(`📊 Grouped into ${periodGroups.size} unique periods`);

  // Calculate entry for each period
  const periodEntries: InflowPeriodEntry[] = [];

  for (const [periodId, periodDocs] of periodGroups) {
    const entry = calculateInflowPeriodEntry(periodDocs);
    periodEntries.push(entry);
  }

  // Sort chronologically
  periodEntries.sort((a, b) =>
    a.periodStartDate.toMillis() - b.periodStartDate.toMillis()
  );

  console.log(`✅ Calculated ${periodEntries.length} inflow period entries`);

  return periodEntries;
}

/**
 * Calculate single inflow period entry from multiple period documents
 */
function calculateInflowPeriodEntry(
  periodDocs: any[]
): InflowPeriodEntry {
  const firstDoc = periodDocs[0];
  const periodId = firstDoc.sourcePeriodId || firstDoc.periodId;

  // Initialize aggregates
  let totalExpected = 0;
  let totalReceived = 0;
  let totalPending = 0;
  let fullyReceivedCount = 0;
  let partialReceivedCount = 0;
  let salaryCount = 0;
  let freelanceCount = 0;
  let investmentCount = 0;
  let otherCount = 0;
  const statusCounts: InflowStatusCounts = {};
  const sourceTotals = new Map<string, { count: number; total: number; isRegularSalary: boolean }>();
  const amounts: number[] = [];

  // Aggregate across all period documents
  for (const doc of periodDocs) {
    // Amounts
    const expected = doc.amountEarned || doc.expectedAmount || 0;
    totalExpected += expected;
    totalReceived += doc.amountReceived || 0;
    totalPending += doc.amountPending || 0;
    amounts.push(expected);

    // Status counts
    const status = doc.status;
    if (status) {
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    // Received status tracking
    if (doc.isFullyReceived) {
      fullyReceivedCount++;
    } else if (doc.amountReceived > 0) {
      partialReceivedCount++;
    }

    // Income type tracking
    const incomeType = doc.incomeType;
    if (incomeType === 'salary') salaryCount++;
    else if (incomeType === 'freelance') freelanceCount++;
    else if (incomeType === 'investment') investmentCount++;
    else otherCount++;

    // Source aggregation
    const source = doc.source || doc.description || 'Unknown';
    const isRegularSalary = doc.isRegularSalary || false;
    if (!sourceTotals.has(source)) {
      sourceTotals.set(source, { count: 0, total: 0, isRegularSalary });
    }
    const sourceData = sourceTotals.get(source)!;
    sourceData.count++;
    sourceData.total += expected;
  }

  // Calculate derived values
  const receivedPercentage = totalExpected > 0
    ? Math.round((totalReceived / totalExpected) * 100)
    : 0;

  // Calculate average amount
  const averageAmount = amounts.length > 0
    ? amounts.reduce((sum, amt) => sum + amt, 0) / amounts.length
    : 0;

  // Build source breakdown (top 5 sources)
  const sourceBreakdown: SourceSummary[] = Array.from(sourceTotals.entries())
    .map(([source, data]) => ({
      source,
      count: data.count,
      totalAmount: data.total,
      isRegularSalary: data.isRegularSalary
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 5);

  return {
    periodId,
    periodStartDate: firstDoc.periodStartDate,
    periodEndDate: firstDoc.periodEndDate,
    totalExpected,
    totalReceived,
    totalPending,
    averageAmount,
    salaryCount,
    freelanceCount,
    investmentCount,
    otherCount,
    sourceBreakdown,
    statusCounts,
    receivedPercentage,
    fullyReceivedCount,
    partialReceivedCount,
    itemCount: periodDocs.length
  };
}
```

**New File:** `/src/functions/inflows/utils/updateInflowPeriodSummary.ts`

Similar pattern to outflow and budget summary updates.

### Phase 3: Trigger Implementation

**New File:** `/src/functions/inflows/orchestration/triggers/onInflowPeriodSummary.ts`

```typescript
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { updateInflowPeriodSummary } from '../../utils/updateInflowPeriodSummary';

export const onInflowPeriodCreatedSummary = onDocumentCreated({
  document: 'inflow_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateInflowPeriodSummary(null, event.data);
});

export const onInflowPeriodUpdatedSummary = onDocumentUpdated({
  document: 'inflow_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateInflowPeriodSummary(event.data.before, event.data.after);
});

export const onInflowPeriodDeletedSummary = onDocumentDeleted({
  document: 'inflow_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateInflowPeriodSummary(event.data, null);
});
```

**Modify:** `/src/functions/inflows/orchestration/triggers/index.ts`
- Export new triggers

### Phase 4: Callable Functions

**New File:** `/src/functions/inflows/api/recalculateInflowSummary.ts`

**Function:** `recalculateInflowSummary` (Callable)
- Same pattern as outflow and budget callable functions

**Modify:** `/src/index.ts`
- Export callable function

### Phase 5: Migration & Data Population

Same 5-step process as outflows and budgets:
1. Deploy infrastructure
2. Deploy core logic
3. Deploy triggers
4. Backfill existing data
5. Frontend integration

## Files Summary

### New Files (7 total)
1. `/src/types/inflowSummaries.ts` - Type definitions
2. `/src/functions/inflows/utils/calculateInflowPeriodSummary.ts` - Full calculation
3. `/src/functions/inflows/utils/updateInflowPeriodSummary.ts` - Incremental updates
4. `/src/functions/inflows/api/recalculateInflowSummary.ts` - Callable function
5. `/src/functions/inflows/orchestration/triggers/onInflowPeriodSummary.ts` - Triggers
6. `/src/functions/inflows/utils/__tests__/calculateInflowPeriodSummary.test.ts` - Unit tests
7. `/src/functions/inflows/utils/__tests__/updateInflowPeriodSummary.test.ts` - Unit tests

### Modified Files (4 total)
1. `/src/types/index.ts` - Export new types
2. `/src/index.ts` - Export callable function
3. `/firestore.rules` - Add inflowSummaries collection rules
4. `/firestore.indexes.json` - Add composite indexes
5. `/src/functions/inflows/orchestration/triggers/index.ts` - Export new triggers

## Success Criteria

1. Inflow summary documents created automatically for all new periods
2. Summaries update in real-time (<5 seconds) when periods change
3. Dashboard loads with 1 read instead of 100+
4. Document sizes remain under 20 KB (well under 1 MB limit)
5. Group summaries aggregate correctly across all members
6. Source breakdown shows top 5 income sources accurately
7. Income type counts (salary/freelance/investment/other) accurate
8. Regular salary flagging works correctly
9. All existing inflow period data backfilled successfully

## Prerequisites

**Before starting inflow summary implementation:**
1. ✅ Outflow summary system deployed and stable
2. ✅ Budget summary system deployed and stable
3. ✅ Both systems tested for 1+ week each
4. ✅ Learned lessons from previous implementations documented
5. ✅ Performance metrics validated for both

## Completion

Once the inflow summary system is stable, the complete Period Summary System will be:
- ✅ **Fully deployed** across all three resource types
- ✅ **Dashboard optimized** with 99% reduction in reads
- ✅ **Ready for production** with comprehensive testing

**Total impact:**
- 3 resource types × 3 period types = 9 summary documents per user
- ~75 KB total per user (vs ~300+ KB previously)
- 99% reduction in read operations
- Real-time updates via triggers
- Full group sharing support
