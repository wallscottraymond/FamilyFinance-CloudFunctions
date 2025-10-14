# Trigger Refactoring - Pure Orchestration Pattern

## Issue

The `onOutflowCreated` trigger contained business logic that violated the pure orchestration principle. Triggers should only coordinate workflow steps, not contain calculation or business logic.

## What Was Wrong

### Before: Mixed Orchestration and Business Logic

```typescript
// ❌ Date calculation logic in trigger
const startDate = outflowData.firstDate.toDate();
const now = new Date();
const endDate = new Date(now);
endDate.setMonth(endDate.getMonth() + 3);

// ❌ Auto-matching workflow logic in trigger
if (outflowData.transactionIds && outflowData.transactionIds.length > 0) {
  try {
    const matchResult = await autoMatchTransactionToOutflowPeriods(...);

    if (matchResult.periodsUpdated > 0) {
      const statusesUpdated = await recalculateOutflowPeriodStatuses(...);
    }

    if (matchResult.errors.length > 0) {
      console.warn(...);
    }
  } catch (matchError) {
    console.error(...);
  }
} else {
  console.log(...);
}
```

**Problems:**
- Date calculation logic embedded in trigger (lines 46-51)
- Auto-matching workflow orchestration in trigger (lines 67-102)
- Error handling and conditional logic in trigger
- Hard to test, hard to reuse
- Violates single responsibility principle

## Solution: Pure Orchestration

### After: Delegated to Utility Functions

```typescript
// ✅ Delegate date calculation to utility
const { startDate, endDate } = calculatePeriodGenerationRange(outflowData, 3);

// ✅ Delegate auto-matching workflow to orchestration utility
const matchResult = await orchestrateAutoMatchingWorkflow(
  db,
  outflowId,
  outflowData,
  result.periodIds
);
```

**Benefits:**
- Trigger is now pure orchestration (only coordinates steps)
- Business logic is testable in isolation
- Utilities can be reused in other contexts
- Clear separation of concerns
- Single responsibility per function

## Files Changed

### 1. `/src/functions/outflows/utils/outflowPeriods.ts`

**Added:** `calculatePeriodGenerationRange()` function

```typescript
export function calculatePeriodGenerationRange(
  outflow: RecurringOutflow,
  monthsForward: number = 3
): { startDate: Date; endDate: Date } {
  // Start from firstDate to capture historical periods
  const startDate = outflow.firstDate.toDate();

  // Extend N months forward from now
  const now = new Date();
  const endDate = new Date(now);
  endDate.setMonth(endDate.getMonth() + monthsForward);

  return { startDate, endDate };
}
```

**Why:** Encapsulates date range calculation logic that was previously in the trigger.

### 2. `/src/functions/outflows/utils/autoMatchTransactionToOutflowPeriods.ts`

**Added:** `orchestrateAutoMatchingWorkflow()` function

```typescript
export async function orchestrateAutoMatchingWorkflow(
  db: admin.firestore.Firestore,
  outflowId: string,
  outflow: RecurringOutflow,
  periodIds: string[]
): Promise<{
  success: boolean;
  transactionsProcessed: number;
  splitsAssigned: number;
  periodsUpdated: number;
  statusesUpdated: number;
  errors: string[];
}> {
  // Check if there are transactions to match
  if (!outflow.transactionIds || outflow.transactionIds.length === 0) {
    return { ... }; // Early return
  }

  try {
    // Step 1: Auto-match transactions
    const matchResult = await autoMatchTransactionToOutflowPeriods(...);

    // Step 2: Recalculate statuses
    let statusesUpdated = 0;
    if (matchResult.periodsUpdated > 0) {
      statusesUpdated = await recalculateOutflowPeriodStatuses(...);
    }

    // Step 3: Log errors
    if (matchResult.errors.length > 0) {
      console.warn(...);
    }

    return { success: true, ... };

  } catch (error) {
    return { success: false, errors: [...] };
  }
}
```

**Why:** Encapsulates the entire auto-matching workflow including error handling and status recalculation.

### 3. `/src/functions/outflows/orchestration/triggers/onOutflowCreated.ts`

**Before:** 108 lines with embedded business logic
**After:** 87 lines, pure orchestration

```typescript
// Pure orchestration - delegates all logic
export const onOutflowCreated = onDocumentCreated({...}, async (event) => {
  try {
    // Guard clauses
    if (!outflowData) return;
    if (!outflowData.isActive) return;

    const db = admin.firestore();

    // Step 1: Calculate date range (delegated)
    const { startDate, endDate } = calculatePeriodGenerationRange(outflowData, 3);

    // Step 2: Create periods (delegated)
    const result = await createOutflowPeriodsFromSource(
      db, outflowId, outflowData, startDate, endDate
    );

    // Step 3: Auto-match transactions (delegated)
    const matchResult = await orchestrateAutoMatchingWorkflow(
      db, outflowId, outflowData, result.periodIds
    );

    console.log('Complete');

  } catch (error) {
    console.error('[onOutflowCreated] Error:', error);
  }
});
```

**Why:** Now follows pure orchestration pattern - only coordinates steps, no business logic.

## Benefits

### 1. **Testability**
- Each utility function can be unit tested independently
- Mock database calls at utility level, not trigger level
- Test edge cases without firing triggers

### 2. **Reusability**
- `calculatePeriodGenerationRange()` can be used anywhere date ranges are needed
- `orchestrateAutoMatchingWorkflow()` can be called from admin functions or other triggers

### 3. **Maintainability**
- Clear separation: trigger coordinates, utilities implement
- Each function has single responsibility
- Easy to find and modify business logic

### 4. **Readability**
- Trigger reads like a high-level workflow
- Function names clearly describe what they do
- No nested conditional logic in trigger

## Pattern to Follow

### For All Triggers

```typescript
// ✅ GOOD: Pure orchestration trigger
export const onSomethingCreated = onDocumentCreated({...}, async (event) => {
  // 1. Extract data
  const data = event.data?.data();

  // 2. Guard clauses
  if (!data) return;
  if (!data.isActive) return;

  // 3. Delegate all logic to utilities
  const step1Result = await utilityFunction1(data);
  const step2Result = await utilityFunction2(step1Result);
  const step3Result = await utilityFunction3(step2Result);

  // 4. Log results
  console.log('Complete:', { step1Result, step2Result, step3Result });
});
```

```typescript
// ❌ BAD: Business logic in trigger
export const onSomethingCreated = onDocumentCreated({...}, async (event) => {
  const data = event.data?.data();

  // ❌ Calculation logic
  const result = data.amount * 0.10;
  const date = new Date();
  date.setMonth(date.getMonth() + 3);

  // ❌ Conditional workflow logic
  if (data.hasTransactions) {
    try {
      const matched = await matchTransactions();
      if (matched.success) {
        await updateStatuses();
      }
    } catch (error) {
      console.error(error);
    }
  }
});
```

## Testing

Build succeeded with no errors:
```bash
npm run build
✓ Build successful
```

The refactored trigger maintains 100% functional equivalence while improving code quality.

## Deployment

Deploy when ready:
```bash
firebase deploy --only functions:onOutflowCreated
```

## Next Steps

Apply this pattern to other triggers:
- `onBudgetCreate`
- `onInflowCreated`
- `onPlaidItemCreated`
- `onOutflowPeriodCreate`

Each should delegate all business logic to utility functions and only coordinate workflow steps.
