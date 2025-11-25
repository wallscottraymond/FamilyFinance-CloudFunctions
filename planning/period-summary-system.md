# Period Summary System Implementation Plan

**Plan Name:** Period Summary System for Dashboard Optimization
**Date:** November 24, 2025
**Status:** Planning - Pending Review

---

## Overview

Implement a comprehensive Period Summary System to optimize dashboard loading by aggregating period data into summary documents, reducing reads from 100+ documents to 1 per resource type.

## Requirements Summary

- **Scope**: All three period types (outflows, budgets, inflows)
- **Frequencies**: Monthly, weekly, bi-weekly
- **Owners**: Both user-level and group-level summaries
- **Time Window**: 1 year backward + 1 year forward (24 months)
- **Update Strategy**: Real-time triggers on period changes
- **Document Pattern**: `{type}Summaries/{ownerId|groupId}_{periodType}`

## Data Size Estimates

- Monthly (24 periods): ~3.4 KB per summary
- Weekly (104 periods): ~14.6 KB per summary
- Bi-weekly (52 periods): ~7.3 KB per summary
- Total per user (9 summaries): ~135 KB
- **Performance**: 99% reduction in read operations

## Architecture

### Document Structure

**Collections:**
- `outflowSummaries/`
- `budgetSummaries/`
- `inflowSummaries/`

**Document ID Pattern:**
- User summaries: `{userId}_{periodType}` (e.g., `user_abc123_monthly`)
- Group summaries: `{groupId}_{periodType}` (e.g., `group_xyz789_monthly`)

**Summary Document Schema:**
```typescript
{
  ownerId: string;              // User ID or Group ID
  ownerType: 'user' | 'group';  // Type of owner
  periodType: 'MONTHLY' | 'weekly' | 'BI_MONTHLY';
  resourceType: 'outflow' | 'budget' | 'inflow';
  windowStart: Timestamp;       // Start of 2-year window
  windowEnd: Timestamp;         // End of 2-year window

  periods: PeriodEntry[];       // Array of period summaries

  // Metadata
  totalItemCount: number;       // Total outflows/budgets/inflows
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**PeriodEntry Schema:**
```typescript
{
  // Period Identity
  periodId: string;             // e.g., "2025M01"
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;

  // Status Breakdown
  statusCounts: {
    PAID: number;
    OVERDUE: number;
    DUE_SOON: number;
    PENDING: number;
    PARTIAL: number;
    // ... other statuses
  };

  // Progress Metrics
  paymentProgressPercentage: number;
  fullyPaidCount: number;
  unpaidCount: number;
  itemCount: number;            // Items with periods in this time range
}
```

## Implementation Phases

### Phase 1: Type Definitions & Infrastructure

**New File:** `/src/types/periodSummaries.ts`

Following existing type patterns from `/src/types/index.ts`:

```typescript
import { Timestamp } from "firebase-admin/firestore";
import { PeriodType } from "./index";

/**
 * Single period's aggregated summary data
 */
export interface PeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01"
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure, NOT nested)
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;

  // Status Breakdown
  statusCounts: StatusCounts;

  // Progress Metrics
  paymentProgressPercentage: number; // (paid / due) × 100
  fullyPaidCount: number;
  unpaidCount: number;
  itemCount: number;                 // Items with periods in this range
}

export interface StatusCounts {
  PAID?: number;
  OVERDUE?: number;
  DUE_SOON?: number;
  PENDING?: number;
  PARTIAL?: number;
  PAID_EARLY?: number;
  NOT_DUE?: number;
}

/**
 * Base summary document structure (generic)
 */
export interface BasePeriodSummary {
  // Identity
  ownerId: string;                   // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: PeriodType;            // MONTHLY, WEEKLY, BI_MONTHLY
  resourceType: 'outflow' | 'budget' | 'inflow';

  // Time Window
  windowStart: Timestamp;            // Start of 2-year window
  windowEnd: Timestamp;              // End of 2-year window

  // Summary Data
  periods: PeriodEntry[];            // Array of period summaries

  // Metadata
  totalItemCount: number;            // Total resources being tracked
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Resource-specific summary types
 */
export interface OutflowPeriodSummary extends BasePeriodSummary {
  resourceType: 'outflow';
}

export interface BudgetPeriodSummary extends BasePeriodSummary {
  resourceType: 'budget';
}

export interface InflowPeriodSummary extends BasePeriodSummary {
  resourceType: 'inflow';
}
```

**Modify:** `/src/types/index.ts`
```typescript
// Add to exports
export * from "./periodSummaries";
```

**Modify:** `/firestore.rules`

Following existing security rule patterns:

```javascript
// Period Summary Collections
match /{resourceType}Summaries/{summaryId} {
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
  return groupId in userDoc.data.groupIds;
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
},
{
  "collectionGroup": "budget_periods",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "periodType", "order": "ASCENDING" },
    { "fieldPath": "startDate", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "budget_periods",
  "fields": [
    { "fieldPath": "groupId", "order": "ASCENDING" },
    { "fieldPath": "periodType", "order": "ASCENDING" },
    { "fieldPath": "startDate", "order": "ASCENDING" }
  ]
}
// Repeat similar patterns for inflow_periods
```

### Phase 2: Core Utilities

**New File:** `/src/functions/shared/utils/calculatePeriodSummary.ts`

Following patterns from `/src/functions/budgets/utils/budgetSpending.ts`:

```typescript
import * as admin from 'firebase-admin';
import { PeriodEntry, StatusCounts } from '../../../types/periodSummaries';
import { PeriodType } from '../../../types';

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

/**
 * Calculate period summary for a specific resource type and owner
 * Pattern matches budgetSpending.ts aggregation approach
 */
export async function calculatePeriodSummary(
  resourceType: 'outflow' | 'budget' | 'inflow',
  ownerId: string,
  ownerType: 'user' | 'group',
  periodType: PeriodType
): Promise<PeriodEntry[]> {
  console.log(`📊 Calculating ${resourceType} period summary:`, {
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

  // Query all periods in window
  const collectionName = `${resourceType}_periods`;
  const ownerField = ownerType === 'user' ? 'userId' : 'groupId';

  const periodsQuery = db.collection(collectionName)
    .where(ownerField, '==', ownerId)
    .where('periodType', '==', periodType)
    .where('periodStartDate', '>=', windowStartTs)
    .where('periodStartDate', '<=', windowEndTs)
    .where('isActive', '==', true);

  const periodsSnapshot = await periodsQuery.get();

  console.log(`📊 Found ${periodsSnapshot.size} periods in window`);

  if (periodsSnapshot.empty) {
    return [];
  }

  // Group periods by sourcePeriodId (or periodId for budgets)
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
  const periodEntries: PeriodEntry[] = [];

  for (const [periodId, periodDocs] of periodGroups) {
    const entry = calculatePeriodEntry(periodDocs, resourceType);
    periodEntries.push(entry);
  }

  // Sort chronologically
  periodEntries.sort((a, b) =>
    a.periodStartDate.toMillis() - b.periodStartDate.toMillis()
  );

  console.log(`✅ Calculated ${periodEntries.length} period entries`);

  return periodEntries;
}

/**
 * Calculate single period entry from multiple period documents
 * Aggregates amounts and statuses across all items in the period
 */
function calculatePeriodEntry(
  periodDocs: any[],
  resourceType: 'outflow' | 'budget' | 'inflow'
): PeriodEntry {
  const firstDoc = periodDocs[0];
  const periodId = firstDoc.sourcePeriodId || firstDoc.periodId;

  // Initialize aggregates
  let totalAmountDue = 0;
  let totalAmountPaid = 0;
  let fullyPaidCount = 0;
  let unpaidCount = 0;
  const statusCounts: StatusCounts = {};

  // Aggregate across all period documents
  for (const doc of periodDocs) {
    // Amounts (field names vary by resource type)
    if (resourceType === 'outflow') {
      totalAmountDue += doc.totalAmountDue || doc.amountDue || 0;
      totalAmountPaid += doc.totalAmountPaid || 0;
    } else if (resourceType === 'budget') {
      totalAmountDue += doc.allocatedAmount || doc.modifiedAmount || 0;
      totalAmountPaid += doc.spent || 0;
    } else if (resourceType === 'inflow') {
      totalAmountDue += doc.amountEarned || 0;
      totalAmountPaid += doc.amountReceived || 0;
    }

    // Status counts
    const status = doc.status;
    if (status) {
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    // Paid vs unpaid tracking
    if (resourceType === 'outflow') {
      if (doc.isFullyPaid || doc.isPaid) {
        fullyPaidCount++;
      } else {
        unpaidCount++;
      }
    } else if (resourceType === 'budget') {
      if (doc.spent >= doc.allocatedAmount) {
        fullyPaidCount++; // Over budget counts as "paid"
      } else {
        unpaidCount++;
      }
    }
  }

  const totalAmountUnpaid = totalAmountDue - totalAmountPaid;
  const paymentProgressPercentage = totalAmountDue > 0
    ? Math.round((totalAmountPaid / totalAmountDue) * 100)
    : 0;

  return {
    periodId,
    periodStartDate: firstDoc.periodStartDate,
    periodEndDate: firstDoc.periodEndDate,
    totalAmountDue,
    totalAmountPaid,
    totalAmountUnpaid,
    statusCounts,
    paymentProgressPercentage,
    fullyPaidCount,
    unpaidCount,
    itemCount: periodDocs.length
  };
}
```

**New File:** `/src/functions/shared/utils/updatePeriodSummary.ts`

**Key Function:** `updatePeriodSummary()`
- **Input**: resourceType, periodChange (old and new period data)
- **Process**:
  1. Extract ownerId, periodType, periodId from period
  2. Determine if user summary and/or group summary need updates
  3. For each affected summary:
     - Fetch existing summary document
     - If doesn't exist, call full recalculation
     - Find affected period entry in summary
     - Recalculate that single entry from all periods with same periodId
     - Update summary document atomically
- **Output**: Updated summary documents

**Trigger Handling:**
- **onCreate**: Add new period to summary
- **onUpdate**: Recalculate affected period entry
- **onDelete**: Recalculate (may remove entry if last period)

### Phase 3: Trigger Implementation

**Pattern**: 3 triggers per resource type × 3 operations = 9 triggers per resource

**Outflow Triggers:**

**New File:** `/src/functions/outflows/orchestration/triggers/onOutflowPeriodSummary.ts`
```typescript
export const onOutflowPeriodCreated = onDocumentCreated(
  'outflow_periods/{periodId}',
  async (event) => {
    await updatePeriodSummary('outflow', null, event.data);
  }
);

export const onOutflowPeriodUpdated = onDocumentUpdated(
  'outflow_periods/{periodId}',
  async (event) => {
    await updatePeriodSummary('outflow', event.data.before, event.data.after);
  }
);

export const onOutflowPeriodDeleted = onDocumentDeleted(
  'outflow_periods/{periodId}',
  async (event) => {
    await updatePeriodSummary('outflow', event.data, null);
  }
);
```

**Budget Triggers:**
**New File:** `/src/functions/budgets/orchestration/triggers/onBudgetPeriodSummary.ts`
- Same pattern for `budget_periods` collection

**Inflow Triggers:**
**New File:** `/src/functions/inflows/orchestration/triggers/onInflowPeriodSummary.ts`
- Same pattern for `inflow_periods` collection

**Modify Trigger Index Files:**
- `/src/functions/outflows/orchestration/triggers/index.ts` - Export new triggers
- `/src/functions/budgets/orchestration/triggers/index.ts` - Export new triggers
- `/src/functions/inflows/orchestration/triggers/index.ts` - Export new triggers

### Phase 4: Callable Functions

**New File:** `/src/functions/shared/api/recalculatePeriodSummary.ts`

**Function:** `recalculatePeriodSummary` (Callable)
- **Purpose**: Manual recalculation for backfill/debugging
- **Parameters**:
  - `resourceType`: 'outflow' | 'budget' | 'inflow'
  - `ownerId`: User ID or Group ID
  - `ownerType`: 'user' | 'group'
  - `periodType`: 'MONTHLY' | 'WEEKLY' | 'BI_MONTHLY'
- **Authorization**: Users can only recalculate their own summaries
- **Process**:
  1. Validate authorization
  2. Call `calculatePeriodSummary()` to get fresh data
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

**Step 3: Deploy Triggers (Incrementally)**
1. Deploy outflow triggers first
2. Monitor for 24 hours
3. Deploy budget triggers
4. Monitor for 24 hours
5. Deploy inflow triggers

**Step 4: Backfill Existing Data**
1. Create admin script to call `recalculatePeriodSummary` for all users
2. Process in batches (100 users at a time)
3. Monitor Firestore usage and function execution
4. Validate sample summaries manually

**Step 5: Frontend Integration (Future)**
1. Update mobile app to query summaries instead of periods
2. Display aggregated metrics in dashboard
3. Load full periods only when tiles clicked

## Security Rules

```javascript
// Summary collections: Read-only for users, write-only for Cloud Functions
match /{resourceType}Summaries/{summaryId} {
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
    },
    // Repeat for budget_periods and inflow_periods
  ]
}
```

## Testing Strategy

### Unit Tests

**Test File:** `/src/functions/shared/utils/__tests__/calculatePeriodSummary.test.ts`
- Test period entry aggregation with multiple periods
- Test status counting accuracy
- Test progress percentage calculations
- Test empty period handling

**Test File:** `/src/functions/shared/utils/__tests__/updatePeriodSummary.test.ts`
- Test incremental updates on onCreate
- Test incremental updates on onUpdate
- Test period removal on onDelete
- Test fallback to full recalculation

### Integration Tests
- Create outflow_period → verify summary updates within seconds
- Update period status → verify entry recalculation
- Delete period → verify entry removal or recalculation

### Manual Testing Checklist
1. Create new outflow with periods → summary auto-created
2. Mark period as paid → summary updates status counts
3. Delete outflow period → summary reflects change
4. Share outflow with group → group summary created
5. Verify summary document sizes under limits

## Performance Considerations

**Before (Current System):**
- Dashboard load: Query 100+ period documents
- Network: ~100 reads × 1 KB = ~100 KB
- Cost: 100 reads per dashboard load

**After (With Summaries):**
- Dashboard load: Query 1 summary document
- Network: 1 read × 15 KB = ~15 KB
- Cost: 1 read per dashboard load
- **Savings: 99% reduction in reads**

**Write Impact:**
- +1-2 writes per period change (user + group summaries)
- Triggers are async (no user-facing latency)
- Incremental updates minimize computation

**Scalability:**
- Maximum 104 periods (weekly) × ~140 bytes = ~15 KB
- Well under 1 MB Firestore document limit
- Supports up to 100 items per user without issues

## Files Summary

### New Files (11 total)
1. `/src/types/periodSummaries.ts` - Type definitions
2. `/src/functions/shared/utils/calculatePeriodSummary.ts` - Full calculation
3. `/src/functions/shared/utils/updatePeriodSummary.ts` - Incremental updates
4. `/src/functions/shared/api/recalculatePeriodSummary.ts` - Callable function
5. `/src/functions/outflows/orchestration/triggers/onOutflowPeriodSummary.ts` - Outflow triggers
6. `/src/functions/budgets/orchestration/triggers/onBudgetPeriodSummary.ts` - Budget triggers
7. `/src/functions/inflows/orchestration/triggers/onInflowPeriodSummary.ts` - Inflow triggers
8-10. Test files for utilities
11. Migration script (admin)

### Modified Files (5 total)
1. `/src/types/index.ts` - Export new types
2. `/src/index.ts` - Export callable function
3. `/firestore.rules` - Add summary collection rules
4. `/firestore.indexes.json` - Add composite indexes
5. Trigger index files - Export new triggers

## Success Criteria

1. Summary documents created automatically for all new periods
2. Summaries update in real-time (<5 seconds) when periods change
3. Dashboard loads with 1 read instead of 100+
4. Document sizes remain under 20 KB (well under 1 MB limit)
5. Group summaries aggregate correctly across all members
6. All existing period data backfilled successfully

## Risk Mitigation

**Risk**: Firestore document size limit exceeded
- **Mitigation**: Current calculations show max 15 KB (well under 1 MB)
- **Monitoring**: Track document sizes in production

**Risk**: Trigger failures causing inconsistent summaries
- **Mitigation**: Callable function for manual recalculation
- **Monitoring**: Cloud Function error logs

**Risk**: High write costs from frequent updates
- **Mitigation**: Incremental updates only affect single period entry
- **Optimization**: Batch multiple changes if needed

**Risk**: Group summary calculation complexity
- **Mitigation**: Same pattern as user summaries, just different ownerId
- **Testing**: Comprehensive integration tests

## Future Enhancements

1. **Caching**: Add client-side caching of summary documents
2. **Pagination**: If summaries grow large, split into multiple documents
3. **Analytics**: Track summary usage and performance metrics
4. **Rollup Summaries**: Yearly summaries aggregating monthly data
5. **Historical Archives**: Move old period entries to archive collection
