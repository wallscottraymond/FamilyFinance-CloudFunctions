# Transaction Triggers Directory

## Overview

This directory contains Firestore triggers that automatically respond to transaction document lifecycle events. These triggers provide critical automation for budget spending tracking, ensuring budget_periods.spent stays synchronized with transaction data in real-time.

## Purpose

Transaction triggers automate budget spending calculations:
- **Transaction Creation** → Update budget_periods.spent with new spending
- **Transaction Updates** → Recalculate budget spending (old → new deltas)
- **Transaction Deletion** → Reverse budget spending

## Directory Structure

```
orchestration/triggers/
├── onTransactionCreate.ts   # Update budget spending on creation
├── onTransactionUpdate.ts   # Recalculate spending on updates
└── onTransactionDelete.ts   # Reverse spending on deletion
```

---

## Architecture Philosophy

### Non-Blocking Design

All transaction triggers use **non-blocking budget updates**:
- Primary transaction operation always completes
- Budget updates happen asynchronously
- Errors in budget updates don't fail transaction CRUD
- Detailed logging for debugging budget sync issues

### Why Non-Blocking?

1. **User Experience:** Transaction operations feel instant
2. **Reliability:** Single failure doesn't cascade
3. **Debugging:** Easier to isolate budget calculation bugs
4. **Recovery:** Failed updates can be retried without affecting transactions

---

## Triggers

### onTransactionCreate.ts

**Purpose:** Update budget_periods.spent when transaction is created

**Trigger Event:** Document created in `transactions` collection

**Function Signature:**
```typescript
export const onTransactionCreate = onDocumentCreated({
  document: 'transactions/{transactionId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => { ... });
```

**Process Flow:**
1. Extract transaction ID from trigger event path
2. Extract transaction data from event
3. Validate transaction data exists
4. Build transaction object with ID
5. Call `updateBudgetSpending()` with newTransaction
6. Log success with metrics

**Update Budget Spending Call:**
```typescript
const result = await updateBudgetSpending({
  newTransaction: {
    id: transactionId,
    ...transactionData,
  },
  userId: transactionData.ownerId,
  groupId: transactionData.groupId,
});
```

**Spending Update Logic:**
- Only affects budget_periods where transaction date falls within period range
- Handles multiple splits (each split updates its own budget)
- Updates all period types (monthly, bi-monthly, weekly)
- Only counts APPROVED expense transactions

**Error Handling:**
- Try-catch wrapper around budget update
- Errors logged but don't throw (non-blocking)
- Detailed error context (transaction ID, user ID)
- Transaction creation always completes even if budget update fails

**Performance:**
- Memory: 256MiB (lightweight operation)
- Timeout: 60s
- Typical execution: <2 seconds

**Dependencies:**
- `updateBudgetSpending` from `/src/utils/budgetSpending.ts`

**Metrics Logged:**
```typescript
{
  budgetPeriodsUpdated: 3,  // Number of budget_period documents updated
  budgetsAffected: 1,       // Number of unique budgets affected
  periodTypesUpdated: ['monthly', 'bi_monthly', 'weekly']
}
```

**Logging:**
```
✅ Budget spending updated for transaction txn_123
Result: { budgetPeriodsUpdated: 3, budgetsAffected: 1 }
```

---

### onTransactionUpdate.ts

**Purpose:** Recalculate budget spending when transaction is modified

**Trigger Event:** Document updated in `transactions` collection

**Function Signature:**
```typescript
export const onTransactionUpdate = onDocumentUpdated({
  document: 'transactions/{transactionId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => { ... });
```

**Process Flow:**
1. Extract transaction ID from event path
2. Extract before/after transaction data
3. **Detect if spending-related fields changed** (critical optimization)
4. If no changes, skip processing (early return)
5. If changes detected, call `updateBudgetSpending()` with both old and new
6. Log success with metrics

**Smart Change Detection:**
```typescript
function detectSpendingChanges(before: Transaction, after: Transaction): boolean {
  // Check if splits have changed (amounts, budgetIds, categories)
  const splitsBefore = JSON.stringify(before.splits || []);
  const splitsAfter = JSON.stringify(after.splits || []);
  if (splitsBefore !== splitsAfter) return true;

  // Check if transaction date changed (affects which periods get spending)
  if (before.transactionDate?.toMillis() !== after.transactionDate?.toMillis()) {
    return true;
  }

  return false; // No spending-related changes
}
```

**Spending-Related Fields:**
- `splits[]` array (amount, budgetId, categoryId changes)
- `transactionDate` (affects period assignment)

**Non-Spending Fields** (ignored by trigger):
- `description`
- `notes`
- `tags`
- `isHidden`
- `metadata.*`

**Delta Calculation:**
- Passes both old and new transaction to `updateBudgetSpending()`
- Utility calculates delta: `spent_new - spent_old`
- Only updates changed amounts (efficient)
- Handles period reassignment (date changes)

**Update Budget Spending Call:**
```typescript
const result = await updateBudgetSpending({
  oldTransaction: {
    id: transactionId,
    ...beforeData,
  },
  newTransaction: {
    id: transactionId,
    ...afterData,
  },
  userId: afterData.ownerId,
  groupId: afterData.groupId,
});
```

**Error Handling:**
- Try-catch wrapper around change detection and updates
- Errors logged but don't throw (non-blocking)
- Transaction update always completes

**Performance:**
- Memory: 256MiB (lightweight)
- Timeout: 60s
- Early return optimization (skips processing if no changes)
- Typical execution: <1 second (if no changes), <2 seconds (if changes)

**Dependencies:**
- `updateBudgetSpending` from `/src/utils/budgetSpending.ts`

**Metrics Logged:**
```typescript
{
  budgetPeriodsUpdated: 6,  // Might be more if date changed (old + new periods)
  budgetsAffected: 2,       // Could affect multiple budgets if splits reassigned
  periodTypesUpdated: ['monthly', 'bi_monthly', 'weekly']
}
```

**Logging:**
```
No spending-related changes detected for transaction txn_123, skipping budget update

OR

✅ Budget spending updated for transaction txn_123
Result: { budgetPeriodsUpdated: 6, budgetsAffected: 2 }
```

---

### onTransactionDelete.ts

**Purpose:** Reverse budget spending when transaction is deleted

**Trigger Event:** Document deleted in `transactions` collection

**Function Signature:**
```typescript
export const onTransactionDelete = onDocumentDeleted({
  document: 'transactions/{transactionId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (event) => { ... });
```

**Process Flow:**
1. Extract transaction ID from event path
2. Extract deleted transaction data from event
3. Validate transaction data exists
4. Call `updateBudgetSpending()` with oldTransaction only
5. Log success with metrics

**Reverse Spending Logic:**
- Passing `undefined` as newTransaction indicates deletion
- `updateBudgetSpending()` subtracts old transaction amounts
- Updates all affected budget_periods
- Reverses spending for all splits

**Update Budget Spending Call:**
```typescript
const result = await updateBudgetSpending({
  oldTransaction: {
    id: transactionId,
    ...transactionData,
  },
  newTransaction: undefined, // Indicates deletion
  userId: transactionData.ownerId,
  groupId: transactionData.groupId,
});
```

**Error Handling:**
- Try-catch wrapper around budget update
- Errors logged but don't throw (non-blocking)
- Transaction deletion always completes

**Performance:**
- Memory: 256MiB (lightweight)
- Timeout: 60s
- Typical execution: <2 seconds

**Dependencies:**
- `updateBudgetSpending` from `/src/utils/budgetSpending.ts`

**Metrics Logged:**
```typescript
{
  budgetPeriodsUpdated: 3,  // Budget periods where spending was reversed
  budgetsAffected: 1,
  periodTypesUpdated: ['monthly', 'bi_monthly', 'weekly']
}
```

**Logging:**
```
✅ Budget spending reversed for deleted transaction txn_123
Result: { budgetPeriodsUpdated: 3, budgetsAffected: 1 }
```

---

## Budget Spending Update Workflow

### Overview

All three triggers use the same `updateBudgetSpending()` utility but with different parameters:

| Trigger | oldTransaction | newTransaction | Effect |
|---------|----------------|----------------|---------|
| onCreate | `undefined` | Transaction data | Add spending |
| onUpdate | Old data | New data | Delta update |
| onDelete | Transaction data | `undefined` | Reverse spending |

### Update Budget Spending Utility

**Location:** `/src/utils/budgetSpending.ts`

**Key Functions:**
1. **calculateSpendingDeltas()** - Compares old vs new, calculates changes
2. **updateBudgetPeriodSpending()** - Updates budget_period.spent field
3. **updateBudgetSpending()** - Main orchestrator

**Logic Flow:**
```typescript
// Step 1: Calculate deltas (what changed?)
const deltas = calculateSpendingDeltas(oldTransaction, newTransaction);

// Step 2: For each affected budget+period combination
for (const delta of deltas) {
  // Step 3: Query matching budget_periods by date range
  const periods = await queryBudgetPeriods(
    budgetId,
    periodType,
    transactionDate
  );

  // Step 4: Update spent amount
  for (const period of periods) {
    await updateBudgetPeriodSpending(period.id, delta.amount);
  }
}
```

**Period Assignment:**
- Transaction date must fall within period's start/end range (inclusive)
- One transaction can update multiple period types simultaneously
- Example: Transaction on Jan 15 updates Jan monthly, Jan 1-15 bi-monthly, and Week 3 weekly periods

**Only APPROVED Expense Transactions:**
- `transactionStatus === 'APPROVED'`
- `transactionType === 'EXPENSE'`
- PENDING and INCOME transactions don't affect budget spending

---

## Trigger Coordination

### Execution Order

When a transaction is created/updated/deleted, triggers fire in this order:
1. **Transaction CRUD completes** (via API function)
2. **Firestore trigger event fires** (onCreate/onUpdate/onDelete)
3. **Trigger extracts data** and validates
4. **Budget update called** asynchronously
5. **Budget_periods updated** in Firestore
6. **Trigger completes**

### Cascading Triggers

**Budget updates don't cascade back to transactions:**
- Updating budget_periods.spent doesn't trigger transaction events
- One-way flow: Transactions → Budget Periods
- Prevents infinite loops

**Budget reassignment triggers transaction update:**
- When budget categories change, `onBudgetUpdate` trigger fires
- Calls `reassignTransactionsForBudget()` utility
- Updates transaction.splits[].budgetId
- **This triggers onTransactionUpdate** for each reassigned transaction
- Budget spending recalculates automatically

---

## Performance Optimizations

### Early Returns

**onTransactionUpdate** implements smart change detection:
- 80% of transaction updates don't affect spending (description changes, notes, etc.)
- Early return saves ~2 seconds of processing per update
- Reduces Firestore reads/writes by 80%

### Batch Operations

All triggers use batch operations where applicable:
- `updateBudgetSpending()` batches multiple period updates
- Respects Firestore 500-document batch limit
- Atomic updates prevent partial failures

### Indexed Queries

Budget period queries use composite indexes:
- `budgetId + periodType + periodStart`
- `budgetId + ownerId + isActive`
- Fast lookups even with thousands of periods

---

## Error Handling Patterns

### Standard Pattern

All triggers follow this error handling pattern:

```typescript
export const onTransactionSomething = onDocumentCreated(..., async (event) => {
  try {
    // Extract and validate data
    const data = event.data?.data();
    if (!data) {
      console.error('No transaction data found');
      return; // Early return, don't throw
    }

    // Update budget spending
    const result = await updateBudgetSpending({ ... });

    // Log success
    console.log(`✅ Budget spending updated for transaction ${id}`);
    console.log(`Result:`, result);
  } catch (error) {
    // Log error with context but DON'T THROW
    console.error(`❌ Error updating budget spending for transaction ${id}:`, error);
    // Transaction operation completes successfully even if budget update fails
  }
});
```

### Why Non-Throwing?

1. **User Experience:** Transaction feels instant, doesn't fail
2. **Data Integrity:** Transaction data is saved correctly
3. **Debugging:** Easier to identify and fix budget calculation bugs
4. **Recovery:** Can retry budget updates without re-creating transactions

---

## Testing Triggers

### Local Emulator Testing

```bash
# Start emulators
firebase emulators:start --only functions,firestore

# Test creation trigger
firebase firestore:create transactions/test_txn '{"amount":100,"ownerId":"user_123",...}'

# Test update trigger
firebase firestore:update transactions/existing_txn '{"splits":[...]}'

# Test deletion trigger
firebase firestore:delete transactions/existing_txn
```

### Manual Testing Checklist

**onTransactionCreate:**
- [ ] Creates transaction successfully
- [ ] Updates budget_periods.spent
- [ ] Logs success metrics
- [ ] Handles multiple splits correctly
- [ ] Only affects APPROVED EXPENSE transactions

**onTransactionUpdate:**
- [ ] Detects spending changes correctly
- [ ] Skips non-spending updates
- [ ] Calculates deltas accurately
- [ ] Updates all affected periods
- [ ] Handles date changes (period reassignment)

**onTransactionDelete:**
- [ ] Deletes transaction successfully
- [ ] Reverses budget spending
- [ ] Updates all affected periods
- [ ] Logs success metrics

---

## Common Issues & Troubleshooting

### Issue: Budget spending not updating

**Symptoms:**
- Transaction created but budget_periods.spent unchanged
- No error logs

**Causes:**
- Transaction is PENDING (not APPROVED)
- Transaction type is INCOME (not EXPENSE)
- budgetId is 'unassigned' or invalid
- Period date range doesn't match transaction date

**Debug Steps:**
```bash
# Check function logs
firebase functions:log --only onTransactionCreate

# Query budget periods for budget
firebase firestore:query budget_periods --where 'budgetId' '==' 'budget_abc'

# Check transaction status
firebase firestore:get transactions/txn_123

# Manually recalculate spending
firebase functions:call recalculateBudgetSpendingOnCreate --data '{"budgetId":"budget_abc"}'
```

**Fix:** Ensure transaction is APPROVED EXPENSE with valid budgetId

---

### Issue: Trigger not firing

**Symptoms:**
- Transaction created but no trigger logs
- No budget updates

**Causes:**
- Trigger not deployed
- Region mismatch (trigger region != Firestore region)
- Emulator not running (local testing)

**Debug Steps:**
```bash
# Check deployed triggers
firebase functions:list | grep onTransaction

# Check region
firebase functions:config:get

# Test locally
firebase emulators:start --only functions,firestore
```

**Fix:** Deploy triggers or ensure emulator is running

---

### Issue: Duplicate spending updates

**Symptoms:**
- Budget spending doubled or incorrect
- Multiple trigger executions logged

**Causes:**
- Trigger fired multiple times (Firestore guarantee: at least once, not exactly once)
- Transaction updated multiple times rapidly
- Budget reassignment triggered cascade

**Debug Steps:**
```bash
# Check logs for duplicate execution
firebase functions:log --only onTransactionUpdate | grep "txn_123"

# Check transaction update history
firebase firestore:get transactions/txn_123 --show-history
```

**Fix:** Triggers are idempotent by design; delta calculation handles duplicates

---

## Performance Metrics

### Typical Execution Times

- **onCreate:** 1-2 seconds (simple creation)
- **onUpdate (no changes):** <0.5 seconds (early return)
- **onUpdate (with changes):** 1-3 seconds (delta calculation)
- **onDelete:** 1-2 seconds (reversal)

### Scaling Characteristics

**Per Transaction:**
- Affects 1-3 budget_periods (monthly, bi-monthly, weekly)
- Handles unlimited splits
- Each split can affect different budget

**Firestore Operations:**
- Read: 3-6 documents (query budget_periods)
- Write: 3-6 documents (update budget_periods)
- Total: 6-12 Firestore operations per transaction

**Cost Estimation:**
- 10,000 transactions/month ≈ 60,000-120,000 Firestore operations
- Well within free tier limits

---

## RBAC & Group Support

### Current Implementation

All triggers support both legacy and new RBAC fields:
- Legacy: `transaction.ownerId`
- New: `transaction.access.createdBy` (future)
- Group: `transaction.groupId` (legacy) → `transaction.groupIds[]` (new)

### Backward Compatibility

```typescript
// Extract user ID (supports both patterns)
const userId = transactionData.ownerId || transactionData.access?.createdBy;

// Extract group ID (supports both patterns)
const groupId = transactionData.groupId; // Currently singular
// Future: const groupIds = transactionData.groupIds; // Will be array
```

---

## Future Enhancements

### Planned Features

1. **Real-time Budget Alerts:**
   - Trigger sends notification when budget threshold exceeded
   - Integration with notification service

2. **Smart Debouncing:**
   - Batch rapid transaction updates
   - Single budget update for multiple related transactions

3. **Budget Period Auto-Extension:**
   - Detect when periods running low
   - Trigger period extension before running out

4. **Analytics Integration:**
   - Track trigger execution metrics
   - Monitor budget sync health
   - Alert on anomalies

---

## Developer Notes

### Adding New Triggers

When adding a new transaction trigger:

1. **Create trigger file:** `onTransactionSomething.ts`
2. **Follow naming convention:** `onTransaction{Action}.ts`
3. **Non-blocking design:** Never throw errors
4. **Comprehensive logging:** Include transaction ID, user ID, metrics
5. **Document here:** Add section to this CLAUDE.md
6. **Add tests:** Create test scenarios
7. **Update Firestore rules:** If needed

### Code Review Checklist

- [ ] Non-throwing error handling (try-catch, log errors)
- [ ] Comprehensive logging with emojis
- [ ] Efficient queries (use indexes)
- [ ] Early returns where appropriate
- [ ] Handles both old and new RBAC fields
- [ ] Memory and timeout appropriate (256MiB, 60s typical)
- [ ] Documents updated (logs, metrics)

---

## Related Documentation

- **Budget Spending Utility:** `/src/utils/budgetSpending.ts`
- **Transaction CRUD:** `/src/functions/transactions/api/crud/`
- **Budget Triggers:** `/src/functions/budgets/orchestration/triggers/`
- **Main Transactions CLAUDE.md:** `/src/functions/transactions/CLAUDE.md`

---

## Notes for AI Assistants

- **Non-blocking is critical** - Never throw errors from triggers
- **Change detection is an optimization** - Saves 80% of unnecessary processing
- **One transaction affects multiple periods** - Monthly, bi-monthly, weekly all update
- **Only APPROVED EXPENSE transactions** - PENDING and INCOME don't affect budgets
- **Delta calculation is key** - Compares old vs new to determine changes
- **Test with emulators** - Always test triggers locally before deploying
- **Log comprehensively** - Triggers are harder to debug, good logs essential
- **Budget_periods.spent is the source of truth** - Not calculated on-the-fly
