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

**Collection:**
- `outflowSummaries/`

**Document ID Pattern:**
- User summaries: `{userId}_{periodType}` (e.g., `user_abc123_monthly`)
- Group summaries: `{groupId}_{periodType}` (e.g., `group_xyz789_monthly`)

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
  periodId: string;                  // e.g., "2025M01"
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

**Modify:** `/firestore.rules`

Following existing security rule patterns:

```javascript
// Outflow Summary Collections
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

// Helper function (if not already defined)
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
 */
function calculateOutflowPeriodEntry(
  periodDocs: any[]
): OutflowPeriodEntry {
  const firstDoc = periodDocs[0];
  const periodId = firstDoc.sourcePeriodId || firstDoc.periodId;
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

### New Files (7 total)
1. `/src/types/outflowSummaries.ts` - Type definitions
2. `/src/functions/outflows/utils/calculateOutflowPeriodSummary.ts` - Full calculation
3. `/src/functions/outflows/utils/updateOutflowPeriodSummary.ts` - Incremental updates
4. `/src/functions/outflows/api/recalculateOutflowSummary.ts` - Callable function
5. `/src/functions/outflows/orchestration/triggers/onOutflowPeriodSummary.ts` - Triggers
6. `/src/functions/outflows/utils/__tests__/calculateOutflowPeriodSummary.test.ts` - Unit tests
7. `/src/functions/outflows/utils/__tests__/updateOutflowPeriodSummary.test.ts` - Unit tests

### Modified Files (4 total)
1. `/src/types/index.ts` - Export new types
2. `/src/index.ts` - Export callable function
3. `/firestore.rules` - Add outflowSummaries collection rules
4. `/firestore.indexes.json` - Add composite indexes
5. `/src/functions/outflows/orchestration/triggers/index.ts` - Export new triggers

## Success Criteria

1. Outflow summary documents created automatically for all new periods
2. Summaries update in real-time (<5 seconds) when periods change
3. Dashboard loads with 1 read instead of 100+
4. Document sizes remain under 20 KB (well under 1 MB limit)
5. Group summaries aggregate correctly across all members
6. Merchant breakdown shows top 5 merchants accurately
7. isDuePeriod flag accurately reflects current period status
8. amountWithheld totals correctly across all periods
9. averageAmount calculates correctly
10. All existing outflow period data backfilled successfully

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

## Next Steps After Outflows

Once the outflow summary system is:
1. ✅ Deployed successfully
2. ✅ Tested thoroughly
3. ✅ Backfilled for existing users
4. ✅ Running stable for 1 week

Then proceed to **Phase 2: Budget Summary System** using the same pattern.

## Future Enhancements

1. **Caching**: Add client-side caching of summary documents
2. **Analytics**: Track summary usage and performance metrics
3. **Merchant Insights**: Expand merchant analytics beyond top 5
4. **Trend Detection**: Identify spending patterns across periods
5. **Historical Archives**: Move old period entries to archive collection
