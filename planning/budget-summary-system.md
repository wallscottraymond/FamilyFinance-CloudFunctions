# Budget Summary System Implementation Plan

**Plan Name:** Budget Period Summary System for Dashboard Optimization
**Date:** November 24, 2025
**Status:** Planning - Pending Review
**Priority:** Phase 2 of 3 (Outflows → Budgets → Inflows)

---

## Overview

Implement a Budget-specific Period Summary System to optimize dashboard loading by aggregating budget period data into summary documents, reducing reads from 100+ documents to 1 per period type.

This is the **second phase** of the complete Period Summary System. This will be implemented after the outflow summary system is stable and proven.

## Requirements Summary

- **Scope**: Budgets only (spending tracking and allocation)
- **Frequencies**: Monthly, weekly, bi-weekly
- **Owners**: Both user-level and group-level summaries
- **Time Window**: 1 year backward + 1 year forward (24 months)
- **Update Strategy**: Real-time triggers on budget_period changes
- **Document Pattern**: `budgetSummaries/{ownerId|groupId}_{periodType}`

## Data Size Estimates

- Monthly (24 periods): ~3.4 KB per summary
- Weekly (104 periods): ~14.6 KB per summary
- Bi-weekly (52 periods): ~7.3 KB per summary
- Total per user (3 budget summaries): ~25 KB
- **Performance**: 99% reduction in read operations for budget data

## Architecture

### Document Structure

**Collection:**
- `budgetSummaries/`

**Document ID Pattern:**
- User summaries: `{userId}_{periodType}` (e.g., `user_abc123_monthly`)
- Group summaries: `{groupId}_{periodType}` (e.g., `group_xyz789_monthly`)

**Budget Summary Document Schema:**
```typescript
interface BudgetPeriodSummary {
  // Identity
  ownerId: string;              // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: 'MONTHLY' | 'WEEKLY' | 'BI_MONTHLY';
  resourceType: 'budget';       // Always 'budget'

  // Time Window
  windowStart: Timestamp;       // Start of 2-year window
  windowEnd: Timestamp;         // End of 2-year window

  // Summary Data
  periods: BudgetPeriodEntry[];   // Array of period summaries

  // Metadata
  totalItemCount: number;       // Total active budgets being tracked
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Budget Period Entry Schema:**
```typescript
interface BudgetPeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01"
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure)
  totalAllocated: number;            // Total budget allocated
  totalSpent: number;                // Total actually spent
  totalRemaining: number;            // Budget remaining
  totalModified: number;             // Total modified allocations

  // Budget Status
  overBudgetCount: number;           // Budgets over limit
  underBudgetCount: number;          // Budgets under limit
  onTrackCount: number;              // Budgets on track

  // Category Breakdown
  categoryBreakdown: CategorySummary[];  // Spending by category

  // Status Breakdown
  statusCounts: {
    ON_TRACK: number;
    OVER_BUDGET: number;
    UNDER_BUDGET: number;
    NO_ACTIVITY: number;
  };

  // Progress Metrics
  spendingPercentage: number;        // (spent / allocated) × 100
  averageSpending: number;           // Average spent per budget
  itemCount: number;                 // Total budgets with periods in this range
}

interface CategorySummary {
  category: string;                  // Budget category
  allocated: number;                 // Amount allocated
  spent: number;                     // Amount spent
  remaining: number;                 // Amount remaining
}
```

## Implementation Phases

### Phase 1: Type Definitions & Infrastructure

**New File:** `/src/types/budgetSummaries.ts`

Following existing type patterns from `/src/types/index.ts`:

```typescript
import { Timestamp } from "firebase-admin/firestore";
import { PeriodType } from "./index";

/**
 * Category summary for a budget period
 */
export interface CategorySummary {
  category: string;              // Budget category name
  allocated: number;             // Amount allocated
  spent: number;                 // Amount spent
  remaining: number;             // Amount remaining
}

/**
 * Single budget period's aggregated summary data
 */
export interface BudgetPeriodEntry {
  // Period Identity
  periodId: string;                  // e.g., "2025M01"
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;

  // Amount Totals (flat structure, NOT nested)
  totalAllocated: number;
  totalSpent: number;
  totalRemaining: number;
  totalModified: number;             // Modified allocations

  // Budget Status
  overBudgetCount: number;           // Count over limit
  underBudgetCount: number;          // Count under limit
  onTrackCount: number;              // Count on track

  // Category Breakdown
  categoryBreakdown: CategorySummary[];  // Top categories

  // Status Breakdown
  statusCounts: BudgetStatusCounts;

  // Progress Metrics
  spendingPercentage: number;        // (spent / allocated) × 100
  averageSpending: number;           // Average spent per budget
  itemCount: number;                 // Items with periods in this range
}

export interface BudgetStatusCounts {
  ON_TRACK?: number;
  OVER_BUDGET?: number;
  UNDER_BUDGET?: number;
  NO_ACTIVITY?: number;
}

/**
 * Budget period summary document structure
 */
export interface BudgetPeriodSummary {
  // Identity
  ownerId: string;                   // User ID or Group ID
  ownerType: 'user' | 'group';
  periodType: PeriodType;            // MONTHLY, WEEKLY, BI_MONTHLY
  resourceType: 'budget';

  // Time Window
  windowStart: Timestamp;            // Start of 2-year window
  windowEnd: Timestamp;              // End of 2-year window

  // Summary Data
  periods: BudgetPeriodEntry[];      // Array of period summaries

  // Metadata
  totalItemCount: number;            // Total active budgets
  lastRecalculated: Timestamp;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Modify:** `/src/types/index.ts`
```typescript
// Add to exports
export * from "./budgetSummaries";
```

**Modify:** `/firestore.rules`

Following existing security rule patterns:

```javascript
// Budget Summary Collections
match /budgetSummaries/{summaryId} {
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
```

### Phase 2: Core Utilities

**New File:** `/src/functions/budgets/utils/calculateBudgetPeriodSummary.ts`

Following patterns from `/src/functions/budgets/utils/budgetSpending.ts`:

```typescript
import * as admin from 'firebase-admin';
import { BudgetPeriodEntry, BudgetStatusCounts, CategorySummary } from '../../../types/budgetSummaries';
import { PeriodType } from '../../../types';

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

/**
 * Calculate budget period summary for a specific owner
 */
export async function calculateBudgetPeriodSummary(
  ownerId: string,
  ownerType: 'user' | 'group',
  periodType: PeriodType
): Promise<BudgetPeriodEntry[]> {
  console.log(`📊 Calculating budget period summary:`, {
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

  // Query all budget periods in window
  const ownerField = ownerType === 'user' ? 'userId' : 'groupId';

  const periodsQuery = db.collection('budget_periods')
    .where(ownerField, '==', ownerId)
    .where('periodType', '==', periodType)
    .where('startDate', '>=', windowStartTs)
    .where('startDate', '<=', windowEndTs)
    .where('isActive', '==', true);

  const periodsSnapshot = await periodsQuery.get();

  console.log(`📊 Found ${periodsSnapshot.size} budget periods in window`);

  if (periodsSnapshot.empty) {
    return [];
  }

  // Group periods by periodId
  const periodGroups = new Map<string, any[]>();

  periodsSnapshot.forEach(doc => {
    const periodData = doc.data();
    const periodId = periodData.periodId;

    if (!periodGroups.has(periodId)) {
      periodGroups.set(periodId, []);
    }

    periodGroups.get(periodId)!.push({ id: doc.id, ...periodData });
  });

  console.log(`📊 Grouped into ${periodGroups.size} unique periods`);

  // Calculate entry for each period
  const periodEntries: BudgetPeriodEntry[] = [];

  for (const [periodId, periodDocs] of periodGroups) {
    const entry = calculateBudgetPeriodEntry(periodDocs);
    periodEntries.push(entry);
  }

  // Sort chronologically
  periodEntries.sort((a, b) =>
    a.periodStartDate.toMillis() - b.periodStartDate.toMillis()
  );

  console.log(`✅ Calculated ${periodEntries.length} budget period entries`);

  return periodEntries;
}

/**
 * Calculate single budget period entry from multiple period documents
 */
function calculateBudgetPeriodEntry(
  periodDocs: any[]
): BudgetPeriodEntry {
  const firstDoc = periodDocs[0];
  const periodId = firstDoc.periodId;

  // Initialize aggregates
  let totalAllocated = 0;
  let totalSpent = 0;
  let totalModified = 0;
  let overBudgetCount = 0;
  let underBudgetCount = 0;
  let onTrackCount = 0;
  const statusCounts: BudgetStatusCounts = {};
  const categoryTotals = new Map<string, { allocated: number; spent: number }>();
  const spendingAmounts: number[] = [];

  // Aggregate across all period documents
  for (const doc of periodDocs) {
    // Amounts
    const allocated = doc.allocatedAmount || doc.modifiedAmount || 0;
    const spent = doc.spent || 0;
    totalAllocated += allocated;
    totalSpent += spent;
    totalModified += doc.modifiedAmount || 0;
    spendingAmounts.push(spent);

    // Status counts
    const status = doc.status;
    if (status) {
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    // Budget status tracking
    if (spent > allocated) {
      overBudgetCount++;
    } else if (spent < allocated * 0.5) {
      underBudgetCount++;
    } else {
      onTrackCount++;
    }

    // Category aggregation
    const category = doc.categoryName || doc.category || 'Uncategorized';
    if (!categoryTotals.has(category)) {
      categoryTotals.set(category, { allocated: 0, spent: 0 });
    }
    const categoryData = categoryTotals.get(category)!;
    categoryData.allocated += allocated;
    categoryData.spent += spent;
  }

  // Calculate derived values
  const totalRemaining = totalAllocated - totalSpent;
  const spendingPercentage = totalAllocated > 0
    ? Math.round((totalSpent / totalAllocated) * 100)
    : 0;

  // Calculate average spending
  const averageSpending = spendingAmounts.length > 0
    ? spendingAmounts.reduce((sum, amt) => sum + amt, 0) / spendingAmounts.length
    : 0;

  // Build category breakdown (top 10 categories)
  const categoryBreakdown: CategorySummary[] = Array.from(categoryTotals.entries())
    .map(([category, data]) => ({
      category,
      allocated: data.allocated,
      spent: data.spent,
      remaining: data.allocated - data.spent
    }))
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 10);

  return {
    periodId,
    periodStartDate: firstDoc.startDate,
    periodEndDate: firstDoc.endDate,
    totalAllocated,
    totalSpent,
    totalRemaining,
    totalModified,
    overBudgetCount,
    underBudgetCount,
    onTrackCount,
    categoryBreakdown,
    statusCounts,
    spendingPercentage,
    averageSpending,
    itemCount: periodDocs.length
  };
}
```

**New File:** `/src/functions/budgets/utils/updateBudgetPeriodSummary.ts`

Similar pattern to outflow summary updates.

### Phase 3: Trigger Implementation

**New File:** `/src/functions/budgets/orchestration/triggers/onBudgetPeriodSummary.ts`

```typescript
import { onDocumentCreated, onDocumentUpdated, onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { updateBudgetPeriodSummary } from '../../utils/updateBudgetPeriodSummary';

export const onBudgetPeriodCreatedSummary = onDocumentCreated({
  document: 'budget_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateBudgetPeriodSummary(null, event.data);
});

export const onBudgetPeriodUpdatedSummary = onDocumentUpdated({
  document: 'budget_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateBudgetPeriodSummary(event.data.before, event.data.after);
});

export const onBudgetPeriodDeletedSummary = onDocumentDeleted({
  document: 'budget_periods/{periodId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  await updateBudgetPeriodSummary(event.data, null);
});
```

**Modify:** `/src/functions/budgets/orchestration/triggers/index.ts`
- Export new triggers

### Phase 4: Callable Functions

**New File:** `/src/functions/budgets/api/recalculateBudgetSummary.ts`

**Function:** `recalculateBudgetSummary` (Callable)
- Same pattern as outflow callable function

**Modify:** `/src/index.ts`
- Export callable function

### Phase 5: Migration & Data Population

Same 5-step process as outflows:
1. Deploy infrastructure
2. Deploy core logic
3. Deploy triggers
4. Backfill existing data
5. Frontend integration

## Files Summary

### New Files (7 total)
1. `/src/types/budgetSummaries.ts` - Type definitions
2. `/src/functions/budgets/utils/calculateBudgetPeriodSummary.ts` - Full calculation
3. `/src/functions/budgets/utils/updateBudgetPeriodSummary.ts` - Incremental updates
4. `/src/functions/budgets/api/recalculateBudgetSummary.ts` - Callable function
5. `/src/functions/budgets/orchestration/triggers/onBudgetPeriodSummary.ts` - Triggers
6. `/src/functions/budgets/utils/__tests__/calculateBudgetPeriodSummary.test.ts` - Unit tests
7. `/src/functions/budgets/utils/__tests__/updateBudgetPeriodSummary.test.ts` - Unit tests

### Modified Files (4 total)
1. `/src/types/index.ts` - Export new types
2. `/src/index.ts` - Export callable function
3. `/firestore.rules` - Add budgetSummaries collection rules
4. `/firestore.indexes.json` - Add composite indexes
5. `/src/functions/budgets/orchestration/triggers/index.ts` - Export new triggers

## Success Criteria

1. Budget summary documents created automatically for all new periods
2. Summaries update in real-time (<5 seconds) when periods change
3. Dashboard loads with 1 read instead of 100+
4. Document sizes remain under 20 KB (well under 1 MB limit)
5. Group summaries aggregate correctly across all members
6. Category breakdown shows top 10 categories accurately
7. Budget status counts (over/under/on-track) accurate
8. All existing budget period data backfilled successfully

## Prerequisites

**Before starting budget summary implementation:**
1. ✅ Outflow summary system deployed and stable
2. ✅ Outflow summary system tested for 1 week
3. ✅ Learned lessons from outflow implementation documented
4. ✅ Performance metrics validated

## Next Steps After Budgets

Once the budget summary system is stable, proceed to **Phase 3: Inflow Summary System**.
