# Budget Dev Functions

Development and testing utilities for the Budget system. These functions help with frontend testing by allowing quick creation of test budgets and transactions.

## Functions

### `createTestBudget`

**Purpose:** Create a test budget with automatic budget period generation for frontend testing.

**Auth:** Required (any authenticated user)

**Parameters:**
```typescript
{
  amount?: number;              // Budget amount (default: 500)
  name?: string;                // Budget name (default: "Test Budget")
  period?: BudgetPeriod;        // Period type (default: "MONTHLY")
  categoryIds?: string[];       // Category IDs (default: [])
  startDate?: string;           // ISO date string (default: current month start)
  endDate?: string;             // ISO date string (default: 1 year from start)
  isSystemEverythingElse?: boolean; // Create as system budget (default: false)
  groupId?: string;             // Group ID for shared budget (optional)
  currency?: string;            // Currency code (default: "USD")
}
```

**Returns:**
```typescript
{
  success: true,
  message: "Test budget created successfully",
  budget: {
    id: "budget-123",
    name: "Test Budget",
    amount: 500,
    currency: "USD",
    period: "MONTHLY",
    // ... other fields
  },
  periods: {
    count: 78,                   // Total periods generated
    breakdown: {
      MONTHLY: 12,
      BI_MONTHLY: 24,
      WEEKLY: 52
    },
    samples: [...]               // First 3 periods
  },
  userSummaries: {
    count: 5,                    // User summaries found
    summariesWithBudget: 2,      // Summaries containing this budget
    samples: [...]               // Sample entries
  },
  testingInstructions: {
    step1: "Budget created with ID: budget-123",
    step2: "78 budget periods generated",
    step3: "Check user_summaries for budget entries",
    step4: "Create transactions to test spending updates",
    step5: "Verify user_summaries.budgets[].totalSpent updates correctly"
  }
}
```

**Example Usage (Firebase CLI):**
```bash
# Create basic test budget
firebase functions:call createTestBudget --data '{}'

# Create custom test budget
firebase functions:call createTestBudget --data '{
  "name": "Groceries Test",
  "amount": 600,
  "period": "monthly",
  "categoryIds": ["cat_food", "cat_groceries"]
}'

# Create "Everything Else" system budget for testing
firebase functions:call createTestBudget --data '{
  "name": "Everything Else",
  "isSystemEverythingElse": true
}'
```

**Example Usage (React Native):**
```typescript
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functions = getFunctions();
const createTestBudget = httpsCallable(functions, 'createTestBudget');

// Create test budget
const result = await createTestBudget({
  name: 'Test Budget',
  amount: 500,
  period: 'monthly'
});

console.log('Budget created:', result.data.budget.id);
console.log('Periods generated:', result.data.periods.count);
```

---

### `createTestTransaction`

**Purpose:** Create a test transaction linked to a budget to verify spending updates.

**Auth:** Required (budget owner only)

**Parameters:**
```typescript
{
  budgetId: string;             // REQUIRED - Budget ID to link transaction to
  amount?: number;              // Transaction amount (default: 50)
  description?: string;         // Description (default: "Test Transaction")
  date?: string;                // ISO date string (default: now)
  categoryId?: string;          // Category ID (optional, uses budget's first category)
  groupId?: string;             // Group ID (optional)
}
```

**Returns:**
```typescript
{
  success: true,
  message: "Test transaction created successfully",
  transaction: {
    id: "txn-456",
    amount: 50,
    description: "Test Transaction",
    budgetId: "budget-123",
    budgetPeriodId: "budget-123_2025-M01",
    // ... other fields
  },
  budgetPeriod: {
    matched: true,
    before: {
      id: "budget-123_2025-M01",
      spentBefore: 0
    },
    after: {
      id: "budget-123_2025-M01",
      spentAfter: 50,
      remaining: 450,
      spentIncrease: 50
    }
  },
  userSummaries: {
    count: 5,
    samples: [
      {
        summaryId: "user-123_MONTHLY_2025-M01",
        budgetEntry: {
          budgetName: "Test Budget",
          totalAllocated: 500,
          totalSpent: 50,              // ✓ Updated!
          totalRemaining: 450,
          progressPercentage: 10
        }
      }
    ]
  },
  verification: {
    step1: "Transaction created: txn-456",
    step2: "Budget period updated: budget-123_2025-M01",
    step3: "Spent increased by: $50",
    step4: "Check user_summaries.budgets[].totalSpent for changes"
  }
}
```

**Example Usage (Firebase CLI):**
```bash
# Create transaction for existing budget
firebase functions:call createTestTransaction --data '{
  "budgetId": "budget-123",
  "amount": 75,
  "description": "Test grocery purchase"
}'
```

**Example Usage (React Native):**
```typescript
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functions = getFunctions();
const createTestTransaction = httpsCallable(functions, 'createTestTransaction');

// Create test transaction
const result = await createTestTransaction({
  budgetId: 'budget-123',
  amount: 75,
  description: 'Test grocery purchase'
});

console.log('Transaction created:', result.data.transaction.id);
console.log('Spent increased by:', result.data.budgetPeriod.after.spentIncrease);
console.log('New total spent:', result.data.userSummaries.samples[0].budgetEntry.totalSpent);
```

---

## Testing Workflow

### 1. Create Test Budget

```typescript
// Create a test budget
const budgetResult = await createTestBudget({
  name: 'Frontend Test Budget',
  amount: 1000,
  period: 'monthly'
});

const budgetId = budgetResult.data.budget.id;
console.log('Budget ID:', budgetId);
console.log('Periods created:', budgetResult.data.periods.count);
```

**Verify:**
- ✓ Budget appears in budgets collection
- ✓ 78 budget_periods created (12M + 24BM + 52W)
- ✓ user_summaries contains budget entries
- ✓ totalSpent = 0 initially

### 2. Create Test Transaction

```typescript
// Create transaction to test spending update
const txnResult = await createTestTransaction({
  budgetId: budgetId,
  amount: 150,
  description: 'Test spending'
});

console.log('Transaction ID:', txnResult.data.transaction.id);
console.log('Spent before:', txnResult.data.budgetPeriod.before.spentBefore);
console.log('Spent after:', txnResult.data.budgetPeriod.after.spentAfter);
```

**Verify:**
- ✓ Transaction created successfully
- ✓ budget_period.spent updated (0 → 150)
- ✓ budget_period.remaining updated (1000 → 850)
- ✓ user_summaries.budgets[].totalSpent = 150 ✅ **KEY FIX VERIFIED**
- ✓ Triggers fired correctly

### 3. Frontend UI Testing

**Test the fixed user_summaries integration:**

1. **Budget List Screen:**
   - Should show budget with correct totalSpent
   - Progress bars should reflect actual spending
   - Remaining amount should be accurate

2. **Budget Detail Screen:**
   - totalAllocated: $1000
   - totalSpent: $150 (not $0!)
   - totalRemaining: $850
   - progressPercentage: 15%

3. **Create More Transactions:**
   - Add more test transactions
   - Verify user_summaries.budgets[].totalSpent increments
   - Verify real-time updates via Firestore listeners

---

## What These Functions Verify

### ✅ Budget Period Generation
- Budget blueprint → budget_period instances created
- Proportional amount allocation (monthly, bi-monthly, weekly)
- Historical spending calculation from existing transactions

### ✅ User Summaries Integration (THE FIX!)
- budget_periods → user_summaries.budgets[] array
- **totalSpent now reads from budgetPeriod.spent** (was hardcoded to 0)
- **userNotes included** in summary entries
- **maxAmount field populated** for frontend clarity

### ✅ Spending Updates
- Transaction creation triggers updateBudgetSpending()
- budget_period.spent field updated correctly
- user_summaries automatically updated via triggers
- Real-time sync to mobile app

### ✅ Data Flow End-to-End
```
createTestBudget
  ↓
onBudgetCreate trigger fires
  ↓
budget_periods created (78 instances)
  ↓
user_summaries.budgets[] populated
  ↓
createTestTransaction
  ↓
updateBudgetSpending() runs
  ↓
budget_period.spent = 150
  ↓
onBudgetPeriodUpdatedPeriodSummary trigger fires
  ↓
calculateBudgetSummary() reads budgetPeriod.spent ✅ (FIX!)
  ↓
user_summaries.budgets[].totalSpent = 150 ✅
  ↓
Frontend displays actual spending!
```

---

## Cleanup

These functions create real data in Firestore. To clean up test data:

```bash
# Delete test budget (also deletes budget_periods via trigger)
firebase firestore:delete budgets/{budgetId}

# Delete test transaction
firebase firestore:delete transactions/{transactionId}
```

Or use the Firebase console to manually delete test documents.

---

## Important Notes

⚠️ **Development/Staging Only:** These functions should NOT be deployed to production or should be protected by admin-only auth.

⚠️ **Real Data:** These functions create actual Firestore documents. Clean up after testing.

⚠️ **Trigger Dependencies:** These functions rely on Firestore triggers being deployed:
- `onBudgetCreate` - Creates budget_periods
- `onBudgetPeriodUpdatedPeriodSummary` - Updates user_summaries
- Transaction triggers - Update budget spending

⚠️ **Wait Times:** Functions include deliberate delays (2-3 seconds) to allow triggers to fire before querying results.

---

## Troubleshooting

**Budget periods not created:**
- Check `onBudgetCreate` trigger is deployed
- View logs: `firebase functions:log --only onBudgetCreate`
- Verify source_periods collection exists

**user_summaries not updated:**
- Check triggers are deployed: `onBudgetPeriodUpdatedPeriodSummary`
- View logs: `firebase functions:log`
- Verify user_summaries collection exists

**Spending not updating:**
- Check transaction triggers are deployed
- View logs for `updateBudgetSpending`
- Verify transaction has correct budgetId and categoryId

**totalSpent still showing 0:**
- Verify you deployed the fix: `calculateBudgetSummary.ts`
- Check `budgetPeriod.spent` field exists in Firestore
- Rebuild and redeploy: `npm run build && firebase deploy --only functions`
