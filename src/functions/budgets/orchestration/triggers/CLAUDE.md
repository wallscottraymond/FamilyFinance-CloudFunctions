# Budget Triggers Directory

## Overview

This directory contains Firestore triggers that automatically respond to budget document lifecycle events. These triggers provide critical orchestration for the budget system, including automatic period generation, transaction reassignment, and system budget protection.

## Purpose

Budget triggers automate key workflows in the budget system:
- **Budget Creation** → Generate 1 year of budget_period documents
- **Budget Updates** → Reassign transactions when categories change
- **Budget Deletion** → Auto-recreate "Everything Else" system budgets

## Directory Structure

```
orchestration/triggers/
├── index.ts                 # Exports all trigger functions
├── onBudgetCreate.ts        # Generates budget_periods on budget creation
├── onBudgetUpdate.ts        # Reassigns transactions on category changes
└── onBudgetDelete.ts        # Protects system budgets from deletion
```

---

## Triggers

### onBudgetCreate.ts

**Purpose:** Automatically generate budget_periods when a budget is created

**Trigger Event:** Document created in `budgets` collection

**Function Signature:**
```typescript
export const onBudgetCreate = onDocumentCreated({
  document: 'budgets/{budgetId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => { ... });
```

**Process Flow:**
1. Extract budget data from trigger event
2. Log budget details (type, dates, etc.)
3. Call `generateBudgetPeriodsForNewBudget()` to create period instances
4. Log success with count of periods created
5. Recalculate historical transactions (if applicable)
   - Updates both transaction.splits[].budgetId
   - Updates budget_periods.spent
6. Log recalculation results

**Period Generation:**
- **Recurring budgets:** 1 year of periods (12 monthly + 24 bi-monthly + 52 weekly = ~78 periods)
- **Limited budgets:** Periods until specified end date
- Uses source_periods as single source of truth
- Proportional amount allocation (monthly: 1.0x, bi-monthly: 0.5x, weekly: ~0.23x)

**Historical Recalculation:**
- Finds all historical transactions matching budget categories
- Updates transaction splits with new budgetId
- Recalculates budget_periods.spent from transaction data
- Handles both userId and access.createdBy fields (RBAC support)
- Non-blocking: Errors logged but don't fail budget creation

**Error Handling:**
- Non-throwing: Errors logged but budget creation succeeds
- Allows system to be resilient to trigger failures
- Detailed error logging for debugging

**Performance:**
- Memory: 512MiB (for batch operations)
- Timeout: 60s
- Efficient batch writes (respects 500-document limit)

**Dependencies:**
- `generateBudgetPeriodsForNewBudget` - Main workflow orchestrator
- `recalculateHistoricalTransactions` - Historical spending updater

**Logging:**
```
Creating budget periods for budget: budget_abc123
Budget data: { budgetType: 'recurring', startDate: '2025-01-01', ... }
Successfully created 78 budget periods for budget budget_abc123
🔄 Starting historical transaction recalculation for new budget budget_abc123
✅ Historical transaction recalculation completed: { transactionsUpdated: 15, spendingUpdated: 15 }
```

---

### onBudgetUpdate.ts

**Purpose:** Reassign transactions when budget categories change

**Trigger Event:** Document updated in `budgets` collection

**Function Signature:**
```typescript
export const onBudgetUpdatedReassignTransactions = onDocumentUpdated({
  document: 'budgets/{budgetId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => { ... });
```

**Process Flow:**
1. Extract before/after budget data
2. Compare categoryIds using JSON.stringify
3. If unchanged, skip processing (early return)
4. If changed, log detected changes
5. Extract userId (supports userId or access.createdBy)
6. Call `reassignTransactionsForBudget()`
7. Log reassignment count

**Change Detection:**
```typescript
const categoriesBefore = JSON.stringify(beforeData?.categoryIds || []);
const categoriesAfter = JSON.stringify(afterData?.categoryIds || []);

if (categoriesBefore === categoriesAfter) {
  console.log('No category changes detected, skipping reassignment');
  return;
}
```

**Reassignment Process:**
- Finds all transactions with splits assigned to this budget
- Calls `matchTransactionSplitsToBudgets()` to reassign based on new rules
- Updates transactions in batches (500 per batch)
- Transaction updates trigger their own budget spending updates

**Error Handling:**
- Non-throwing: Errors logged but budget update succeeds
- Allows budget configuration changes even if reassignment fails
- Transactions remain in current state if error occurs

**Performance:**
- Memory: 512MiB (for potential large reassignments)
- Timeout: 60s
- Batch operations prevent timeout on large datasets

**Dependencies:**
- `reassignTransactionsForBudget` - Transaction reassignment utility

**Logging:**
```
[onBudgetUpdate] Budget updated: budget_abc123 (Groceries)
[onBudgetUpdate] Category changes detected:
  Before: ["food","groceries"]
  After: ["food","groceries","dining"]
[onBudgetUpdate] Starting transaction reassignment for budget: budget_abc123
[onBudgetUpdate] Successfully reassigned 25 transactions for budget: budget_abc123
```

**Note:** Transaction updates will automatically trigger `updateBudgetSpending()` via the `onTransactionUpdate` trigger, so manual budget_periods updates aren't needed here.

---

### onBudgetDelete.ts

**Purpose:** Auto-recreation safety net for "Everything Else" system budgets

**Trigger Event:** Document deleted in `budgets` collection

**Function Signature:**
```typescript
export const onBudgetDelete = onDocumentDeleted({
  document: 'budgets/{budgetId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => { ... });
```

**Process Flow:**
1. Extract deleted budget data
2. Check if `isSystemEverythingElse === true`
3. If regular budget, do nothing (early return)
4. If system budget, log warning
5. Extract userId and user currency
6. Call `createEverythingElseBudget()` to recreate
7. Log success or failure

**Safety Net:**
Protects against deletion of system budgets via:
- Direct Firestore console deletions
- Admin bypassing Cloud Functions
- Bugs in deletion prevention logic
- Direct API access bypassing validation

**Recreation Logic:**
```typescript
if (budgetData.isSystemEverythingElse === true) {
  console.warn(`⚠️ System "Everything Else" budget deleted for user ${userId}, recreating...`);

  await createEverythingElseBudget(db, userId, userCurrency);

  console.log(`✅ Successfully recreated "Everything Else" budget for user ${userId}`);
}
```

**Error Handling:**
- Non-throwing: Errors logged but deletion completes
- If recreation fails, user can manually trigger via Cloud Function
- Detailed error logging for debugging

**Performance:**
- Memory: 256MiB (low requirements)
- Timeout: 60s
- Lightweight operation (single document create)

**Dependencies:**
- `createEverythingElseBudget` - System budget creator
- `db` - Firestore instance from main index

**Logging:**
```
⚠️ System "Everything Else" budget deleted for user user_123, recreating...
✅ Successfully recreated "Everything Else" budget for user user_123

OR (if not system budget):

Regular budget deleted: budget_abc123 (Groceries)
```

**User Experience:** Transparent - user never knows recreation happened

---

## Trigger Guidelines

### Best Practices

1. **Idempotency:** Design triggers to be idempotent (can run multiple times safely)
2. **Error Handling:** Don't throw errors that would fail the document write
3. **Logging:** Use structured logging with operation context
4. **Debouncing:** Use timestamps to prevent rapid-fire executions
5. **Batching:** Group Firestore writes when possible

### Function Signature Pattern

```typescript
export const onSomethingHappened = onDocumentCreated( // or onDocumentUpdated/onDocumentDeleted
  {
    document: 'collection/{docId}',
    region: 'us-central1',
    memory: '256MiB', // or '512MiB' for heavier operations
    timeoutSeconds: 60,
  },
  async (event) => {
    // 1. Extract data
    const data = event.data?.data();

    // 2. Validate
    if (!data) {
      console.error('No data found');
      return;
    }

    // 3. Process
    try {
      await doSomething(data);
      console.log('Success');
    } catch (error) {
      console.error('Error:', error);
      // Don't throw - allow operation to complete
    }
  }
);
```

### Memory & Timeout Recommendations

| Operation Type | Memory | Timeout | Reason |
|---------------|--------|---------|---------|
| Simple CRUD | 256MiB | 30s | Low resource needs |
| Batch Operations | 512MiB | 60s | Higher memory for batching |
| Large Reassignments | 512MiB | 120s | Potential timeout risk |
| Heavy Processing | 1GiB | 300s | Complex calculations |

---

## Testing Triggers

### Local Emulator Testing

```bash
# Start emulators
firebase emulators:start --only functions,firestore

# Test budget creation trigger
firebase firestore:create budgets/test_budget '{"name":"Test","amount":500,...}'

# Test budget update trigger
firebase firestore:update budgets/existing_budget '{"categoryIds":["new","categories"]}'

# Test budget deletion trigger
firebase firestore:delete budgets/existing_budget
```

### Manual Testing Checklist

**onBudgetCreate:**
- [ ] Creates correct number of periods (12M + 24BM + 52W = 78 for recurring)
- [ ] Limited budget creates only until end date
- [ ] Period amounts correctly calculated (monthly, bi-monthly, weekly)
- [ ] Historical transactions updated if exist
- [ ] Budget metadata updated with period range

**onBudgetUpdate:**
- [ ] Detects category changes correctly
- [ ] Skips processing if no changes
- [ ] Reassigns transactions to new matching budget
- [ ] Handles large transaction counts without timeout
- [ ] Budget_periods.spent updates via transaction triggers

**onBudgetDelete:**
- [ ] Regular budget deletion works normally
- [ ] System budget deletion triggers recreation
- [ ] Recreated budget has correct configuration
- [ ] User can immediately use recreated budget
- [ ] No notification to user about recreation

---

## Common Issues & Troubleshooting

### Issue: Periods not created on budget creation

**Symptoms:**
- Budget created but no budget_periods
- No error logs

**Causes:**
- Source periods missing for date range
- Trigger didn't fire
- Batch write failed silently

**Debug Steps:**
```bash
# Check if source_periods exist
firebase firestore:query source_periods --where 'startDate' '>=' '2025-01-01'

# Check function logs
firebase functions:log --only onBudgetCreate

# Manually trigger period generation
firebase functions:call extendBudgetPeriodsRange --data '{"startDate":"2025-01-01","endDate":"2025-12-31"}'
```

**Fix:** Run admin function to generate missing source periods

---

### Issue: Transactions not reassigning on category change

**Symptoms:**
- Changed budget categories
- Transactions still assigned to old budget

**Causes:**
- Trigger didn't fire
- Transaction query returned no results
- matchTransactionSplitsToBudgets failed

**Debug Steps:**
```bash
# Check function logs
firebase functions:log --only onBudgetUpdatedReassignTransactions

# Manually trigger reassignment
firebase functions:call reassignTransactionsForBudget --data '{"budgetId":"budget_abc"}'

# Query transactions assigned to budget
firebase firestore:query transactions --where 'splits.budgetId' '==' 'budget_abc'
```

**Fix:** Ensure transactions exist and are assigned to the budget

---

### Issue: "Everything Else" budget not recreating

**Symptoms:**
- System budget deleted
- No recreation logged
- User has no "Everything Else" budget

**Causes:**
- Trigger didn't fire
- isSystemEverythingElse flag not set correctly
- createEverythingElseBudget failed

**Debug Steps:**
```bash
# Check function logs
firebase functions:log --only onBudgetDelete

# Check if trigger fired
firebase functions:log | grep "System.*budget deleted"

# Manually recreate
firebase functions:call createMissingEverythingElseBudgets
```

**Fix:** Manually run migration function to recreate for all users

---

## Performance Considerations

### Trigger Execution Time

Typical execution times:
- **onBudgetCreate:** 2-5 seconds (78 period creates + historical recalc)
- **onBudgetUpdate:** 1-10 seconds (depends on transaction count)
- **onBudgetDelete:** <1 second (simple recreation)

### Optimization Strategies

1. **Batch Operations:** Use Firestore batch writes (500 doc limit)
2. **Parallel Processing:** Process independent operations concurrently
3. **Early Returns:** Skip processing when no work needed
4. **Efficient Queries:** Use indexed fields for fast lookups

### Scaling Limits

**Per Budget:**
- Budget periods: ~78 per year for recurring budgets
- Transactions: Unlimited (reassignment batched)
- Historical recalculation: Efficient date-range queries

**Firestore Limits:**
- Batch writes: 500 documents per batch
- Document size: 1 MiB max
- Trigger timeout: 540 seconds max (9 minutes)

---

## Migration & Upgrade Notes

### RBAC Field Support

All triggers support both legacy and new RBAC fields:
- Legacy: `budget.userId`
- New: `budget.access.createdBy`

Pattern:
```typescript
const userId = budgetData.userId || budgetData.access?.createdBy;
```

### Group-Based Sharing

Triggers are prepared for group-based sharing model:
- Budget creation supports `groupIds` array
- Period documents inherit `groupIds` from parent budget
- Historical recalculation handles group context

---

## Future Enhancements

### Planned Features

1. **Smart Period Extension:**
   - Detect when user approaches end of period range
   - Automatically extend before running out

2. **Notification Integration:**
   - Notify user when budget created
   - Alert on large reassignments
   - Warn about system budget recreation

3. **Analytics Tracking:**
   - Track trigger execution times
   - Monitor reassignment counts
   - Alert on anomalies

4. **Conditional Triggers:**
   - Only create certain period types (user preference)
   - Custom period generation rules
   - Smart recalculation (only when needed)

---

## Developer Notes

### Adding New Triggers

When adding a new budget trigger:

1. **Create trigger file:** `onBudgetSomething.ts`
2. **Follow naming convention:** `onBudget{Action}.ts`
3. **Export from index.ts:** Add to exports
4. **Add to main exports:** Export from `src/index.ts`
5. **Document here:** Add section to this CLAUDE.md
6. **Add tests:** Create test file in `__tests__/`
7. **Update Firestore rules:** If needed for security

### Code Review Checklist

- [ ] Non-throwing error handling
- [ ] Comprehensive logging with context
- [ ] Efficient queries (indexed fields)
- [ ] Batch operations where appropriate
- [ ] Proper RBAC field handling (userId + access.createdBy)
- [ ] Memory and timeout appropriate for workload
- [ ] Idempotent design
- [ ] Clear documentation

---

## Related Documentation

- **Main Budget CLAUDE.md:** `/src/functions/budgets/CLAUDE.md`
- **Budget Periods Utils:** `/src/functions/budgets/utils/budgetPeriods.ts`
- **Historical Recalculation:** `/src/functions/budgets/utils/recalculateHistoricalTransactions.ts`
- **Transaction Reassignment:** `/src/functions/budgets/utils/reassignTransactions.ts`
- **System Budget Creation:** `/src/functions/budgets/utils/createEverythingElseBudget.ts`

---

## Notes for AI Assistants

- **Triggers are orchestration only** - they coordinate work, don't contain business logic
- **Non-throwing is critical** - never throw errors that would fail primary operation
- **Batch everything** - respect Firestore 500-document limit
- **Log comprehensively** - triggers are harder to debug, good logs essential
- **Support both RBAC patterns** - userId and access.createdBy for backward compatibility
- **Test with emulators** - always test triggers locally before deploying
- **Monitor execution time** - optimize slow triggers to prevent timeouts
- **Budget_periods are instances** - triggers create them, users interact with them
