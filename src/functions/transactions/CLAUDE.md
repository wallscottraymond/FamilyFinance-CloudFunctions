# Transaction System - Cloud Functions Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [File Structure](#file-structure)
4. [Cloud Functions Reference](#cloud-functions-reference)
5. [Data Structures](#data-structures)
6. [6-Step Processing Pipeline](#6-step-processing-pipeline)
7. [Budget Integration](#budget-integration)
8. [Category Mapping](#category-mapping)
9. [Usage Examples](#usage-examples)
10. [Security & Access Control](#security--access-control)
11. [Development Guidelines](#development-guidelines)
12. [Known Issues & TODOs](#known-issues--todos)

---

## Overview

The Transaction System manages all financial transactions in the Family Finance application, including Plaid-sourced transactions and manual entries. It implements a sophisticated 6-step processing pipeline that transforms raw transaction data into structured, categorized, and budget-assigned records ready for financial tracking and analysis.

### Key Capabilities

- ✅ Transaction CRUD operations (5 Cloud Functions)
- ✅ Transaction splits support (embedded in transactions)
- ✅ Automatic budget assignment via intelligent matching
- ✅ Automatic outflow (bill) matching via scoring algorithm
- ✅ Real-time budget spending updates (3 Firestore triggers)
- ✅ Source period mapping (monthly/weekly/bi-weekly)
- ✅ Category mapping with 5-minute cache
- ✅ Approval workflows (pending/approved/rejected/cancelled)
- ✅ Atomic batch operations (respects 500-doc limit)

### Core Philosophy: Transaction Splits

**Every transaction can have multiple splits:**
- A split represents a portion of the transaction amount
- Each split can be assigned to a different budget or outflow
- Default: One split with full amount assigned to best-matching budget
- Users can manually split transactions across multiple budgets
- Backend fully supports splits; mobile UI implementation pending

---

## Architecture

### 6-Step Processing Pipeline

```
Raw Plaid Data → Step 1: Format → Step 2: Categories → Step 3: Periods
     ↓
Step 4: Budgets → Step 5: Outflows → Step 6: Batch Create → Firestore
     ↓
Firestore Triggers → Budget Spending Updates → User Sees Results
```

### Data Flow

```
1. Plaid API Returns Transactions
   │
2. Format Transactions (Plaid → Internal Structure)
   ├─ Map Plaid fields to internal schema
   ├─ Extract merchant, name, categories
   ├─ Create flat structure
   └─ Output: Formatted Transaction[]
   │
3. Enhance Categories (Match by Merchant/Keywords)
   ├─ Query categories collection
   ├─ Match by merchant name (highest priority)
   ├─ Fall back to transaction name keywords
   └─ Output: Transactions with enhanced categories
   │
4. Match Source Periods (Date-Based Matching)
   ├─ Query source_periods (app-wide)
   ├─ Match by transaction date only
   ├─ Populate: monthlyPeriodId, weeklyPeriodId, biWeeklyPeriodId
   └─ Output: Transactions with period IDs
   │
5. Match Budgets (Assign to User's Budgets)
   ├─ Query user's active budgets
   ├─ Find budget containing transaction date
   ├─ Update split.budgetId for all splits
   └─ Output: Transactions with budget assignments
   │
6. Match Outflows (Intelligent Bill Matching)
   ├─ Query outflow_periods (±3 month window)
   ├─ Score matches (merchant: 50, amount: 30, date: 20)
   ├─ Minimum threshold: 50 points
   └─ Output: Transactions + outflow updates
   │
7. Batch Create (Atomic Firestore Writes)
   ├─ Create transactions in batches (500 limit)
   ├─ Update outflow_periods with references
   └─ Output: Created transaction count
   │
8. Firestore Triggers Fire
   ├─ onTransactionCreate
   ├─ onTransactionUpdate
   ├─ onTransactionDelete
   └─ Calls: updateBudgetSpending() → Updates budget_periods
```

---

## File Structure

```
/src/functions/transactions/
├── api/
│   └── crud/
│       ├── createTransaction.ts          # Create transactions (manual)
│       ├── updateTransaction.ts          # Update existing transactions
│       ├── deleteTransaction.ts          # Delete transactions
│       ├── getTransaction.ts             # Get single transaction by ID
│       └── approveTransaction.ts         # Approve/reject workflow
│
├── orchestration/
│   └── triggers/
│       ├── onTransactionCreate.ts        # Budget update on create
│       ├── onTransactionUpdate.ts        # Budget recalculation on update
│       └── onTransactionDelete.ts        # Budget reversal on delete
│
├── utils/
│   ├── formatTransactions.ts            # Step 1: Format Plaid data
│   ├── matchCategoriesToTransactions.ts # Step 2: Category enhancement
│   ├── matchTransactionSplitsToSourcePeriods.ts # Step 3: Period matching
│   ├── matchTransactionSplitsToBudgets.ts # Step 4: Budget assignment
│   ├── matchTransactionSplitsToOutflows.ts # Step 5: Outflow matching
│   ├── batchCreateTransactions.ts       # Step 6: Batch writes
│   ├── buildTransactionData.ts          # Transaction document builder
│   ├── categoryMapper.ts                # Category mapping with cache
│   └── [legacy utils for old structure]
│
├── dev/
│   ├── createTestTransactions.ts        # Development function (full pipeline test)
│   └── index.ts
│
├── admin/
│   └── createTestTransactions.ts        # Admin test function
│
└── index.ts                              # Exports all functions
```

---

## Cloud Functions Reference

### CRUD Operations

#### 1. createTransaction (HTTP POST)
**Endpoint:** `/transactions/create`
**Auth:** VIEWER role minimum
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Create new manual transactions (non-Plaid) with budget integration

**Request:**
```typescript
{
  amount: number;
  description: string;
  transactionDate: string; // ISO date
  accountId: string;
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  groupId?: string; // Single group ID (converted to groupIds array)
  categoryId?: string;
  merchantName?: string;
}
```

**Key Behavior:**
- Converts single `groupId` → `groupIds[]` array
- Creates default split with `budgetId: 'unassigned'`
- Matches splits to source periods (monthly/weekly/bi-weekly)
- Validates against family spending limits
- Triggers budget spending updates automatically
- Supports approval workflows based on amount/role

**Response:**
```typescript
{
  success: boolean;
  transactionId?: string;
  message?: string;
}
```

---

#### 2. updateTransaction (HTTP PUT)
**Endpoint:** `/transactions/update/:transactionId`
**Auth:** VIEWER (own transactions) or ADMIN
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Update existing transactions with budget recalculation

**Request:**
```typescript
{
  amount?: number;
  description?: string;
  transactionDate?: string;
  splits?: TransactionSplit[];
  // ... other updatable fields
}
```

**Key Behavior:**
- Recalculates budget spending for changed amounts
- Handles split modifications
- Updates transaction date (re-matches to periods)
- Non-blocking budget updates (errors logged, not thrown)

---

#### 3. deleteTransaction (HTTP DELETE)
**Endpoint:** `/transactions/delete/:transactionId`
**Auth:** VIEWER (own transactions) or ADMIN
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Remove transactions and reverse budget spending

**Key Behavior:**
- Reverses budget spending before deletion
- Handles split cleanup
- Non-blocking budget updates

---

#### 4. getTransaction (HTTP GET)
**Endpoint:** `/transactions/get/:transactionId`
**Auth:** VIEWER role
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Retrieve single transaction by ID

**Response:**
```typescript
{
  success: boolean;
  transaction?: Transaction;
  message?: string;
}
```

---

#### 5. approveTransaction (HTTP POST)
**Endpoint:** `/transactions/approve/:transactionId`
**Auth:** EDITOR role minimum
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Approve or reject pending transactions

**Request:**
```typescript
{
  status: 'APPROVED' | 'REJECTED';
}
```

**Key Behavior:**
- Changes transaction status: PENDING → APPROVED/REJECTED
- Records approver ID and timestamp
- Used for expense approval workflows
- Only affects transactions with status: PENDING

---

### Firestore Triggers

#### onTransactionCreate (Firestore Trigger)
**Trigger:** Document creation in `transactions` collection
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Update budget_periods spent amounts when transaction created

**Actions:**
1. Extracts all transaction splits
2. Groups splits by budgetId
3. Calls `updateBudgetSpending()` utility
4. Logs budget periods updated and affected budgets

**Non-Blocking:** Errors logged but don't fail transaction creation

---

#### onTransactionUpdate (Firestore Trigger)
**Trigger:** Document update in `transactions` collection
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Recalculate budget spending with old/new values

**Actions:**
1. Detects spending-related changes (amount, date, splits, status)
2. Skips processing if no relevant changes
3. Reverses old spending + applies new spending
4. Handles date changes (re-matches to periods)

**Smart Diffing:** Only processes if amount, splits, or date changed

---

#### onTransactionDelete (Firestore Trigger)
**Trigger:** Document deletion from `transactions` collection
**Memory:** 256MB | **Timeout:** 30s

**Purpose:** Reverse budget spending when transaction deleted

**Actions:**
1. Calls `updateBudgetSpending()` with `newTransaction: undefined`
2. Indicates deletion for reversal logic
3. Handles all split reversals
4. Non-blocking reversal

---

## Data Structures

### Transaction Document

```typescript
interface Transaction extends BaseDocument {
  // ===== QUERY-CRITICAL FIELDS AT ROOT (INDEXED) =====
  transactionId: string;        // Plaid ID or manual ID
  ownerId: string;              // User who owns transaction
  groupId: string | null;       // Group (null = private)
  transactionDate: Timestamp;   // When transaction occurred
  accountId: string;            // Plaid account reference
  createdBy: string;            // Creator user ID
  updatedBy: string;            // Last editor user ID
  currency: string;             // ISO code (e.g., "USD")
  description: string;          // Merchant/description

  // ===== CATEGORY FIELDS (FLATTENED) =====
  internalDetailedCategory: string | null;  // User override detailed
  internalPrimaryCategory: string | null;   // User override primary
  plaidDetailedCategory: string;            // Plaid detailed
  plaidPrimaryCategory: string;             // Plaid primary

  // ===== PLAID METADATA (FLATTENED) =====
  plaidItemId: string;          // Plaid item ID
  source: 'plaid' | 'manual' | 'import';
  transactionStatus: TransactionStatus;  // PENDING, APPROVED, REJECTED, CANCELLED

  // ===== TYPE AND IDENTIFIERS =====
  type: TransactionType;        // INCOME, EXPENSE, TRANSFER
  name: string;                 // Transaction name
  merchantName: string | null;  // Merchant from Plaid

  // ===== SPLITS ARRAY (CRITICAL FOR BUDGET/OUTFLOW ASSIGNMENT) =====
  splits: TransactionSplit[];   // Array of splits (default: 1 split)

  // ===== INITIAL PLAID DATA PRESERVATION =====
  initialPlaidData: {
    plaidAccountId: string;
    plaidMerchantName: string;
    plaidName: string;
    plaidTransactionId: string;
    plaidPending: boolean;
    source: 'plaid';
  };

  // ===== METADATA =====
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isActive: boolean;
}
```

### Transaction Split

```typescript
interface TransactionSplit {
  // Identity
  splitId: string;              // Unique split identifier

  // Budget Assignment
  budgetId: string;             // Budget assignment ('unassigned' if not assigned)

  // Source Period IDs (populated by matchTransactionSplitsToSourcePeriods)
  monthlyPeriodId: string | null;
  weeklyPeriodId: string | null;
  biWeeklyPeriodId: string | null;

  // Outflow Assignment
  outflowId?: string | null;    // Outflow assignment (for bills)

  // Category Information
  plaidPrimaryCategory: string;
  plaidDetailedCategory: string;
  internalPrimaryCategory: string | null;   // User override
  internalDetailedCategory: string | null;  // User override

  // Amount and Status
  amount: number;               // Amount allocated to this split
  description?: string | null;  // Optional override description
  isDefault: boolean;           // True for auto-created split

  // Enhanced Status Tracking
  isIgnored?: boolean;          // Exclude from budget tracking
  isRefund?: boolean;           // Refund transaction
  isTaxDeductible?: boolean;    // Tax classification
  ignoredReason?: string | null;
  refundReason?: string | null;

  // Payment Tracking
  paymentType?: PaymentType;    // REGULAR, CATCH_UP, ADVANCE, EXTRA_PRINCIPAL
  paymentDate: Timestamp;       // When paid (=transaction date)

  // Metadata
  rules: string[];              // Applied rule IDs (future use)
  tags: string[];               // User-defined tags
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Enums

```typescript
enum TransactionStatus {
  PENDING = "pending",       // Awaiting approval
  APPROVED = "approved",     // Accepted
  REJECTED = "rejected",     // Denied
  CANCELLED = "cancelled"    // Voided
}

enum TransactionType {
  INCOME = "income",         // Money in
  EXPENSE = "expense",       // Money out
  TRANSFER = "transfer"      // Internal transfers
}

enum PaymentType {
  REGULAR = "regular",               // Normal payment
  CATCH_UP = "catch_up",            // Late payment
  ADVANCE = "advance",              // Early payment
  EXTRA_PRINCIPAL = "extra_principal" // Extra payment
}
```

---

## 6-Step Processing Pipeline

### Step 1: Format Transactions

**File:** `/utils/formatTransactions.ts`
**Purpose:** Transform raw Plaid transactions into internal structure

**Input:** Raw Plaid transaction array
**Output:** Array of formatted `Transaction` objects

**Process:**
1. Maps Plaid transaction fields to internal schema
2. Extracts merchant, name, and categories
3. Looks up account information from Firestore
4. Creates flat structure with null values for future population
5. No database writes (pure memory transformation)

**Example:**
```typescript
// Plaid input
{
  transaction_id: "plaid_123",
  amount: 50.00,
  merchant_name: "Starbucks",
  personal_finance_category: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_COFFEE_SHOPS"
  }
}

// Formatted output
{
  transactionId: "plaid_123",
  amount: 50.00,
  merchantName: "Starbucks",
  plaidPrimaryCategory: "FOOD_AND_DRINK",
  plaidDetailedCategory: "FOOD_AND_DRINK_COFFEE_SHOPS",
  internalPrimaryCategory: null,  // To be populated
  internalDetailedCategory: null,
  splits: []  // To be populated
}
```

---

### Step 2: Enhance Categories

**File:** `/utils/matchCategoriesToTransactions.ts`
**Purpose:** Match Plaid categories to internal category system

**Input:** Formatted transactions array
**Output:** Transactions with enhanced category assignments

**Process:**
1. Queries `categories` collection for mappings
2. Matches by merchant name (highest priority)
3. Falls back to transaction name keyword matching
4. Updates `plaidPrimaryCategory` and `plaidDetailedCategory`
5. Applies to all splits in transaction
6. In-memory processing, non-blocking

**Matching Priority:**
1. **Merchant Name:** `categories.merchants[]` contains merchant
2. **Keyword Matching:** `categories.keywords[]` in transaction name
3. **Plaid Category:** Direct Plaid category mapping
4. **Default:** `OTHER_EXPENSE`

**Example:**
```typescript
// Input transaction
{
  merchantName: "Whole Foods",
  plaidPrimaryCategory: "FOOD_AND_DRINK"
}

// Category document in Firestore
{
  name: "Groceries",
  merchants: ["Whole Foods", "Trader Joe's"],
  primary_plaid_category: "FOOD_AND_DRINK"
}

// Enhanced output
{
  merchantName: "Whole Foods",
  plaidPrimaryCategory: "FOOD_AND_DRINK",
  internalPrimaryCategory: "Groceries",  // Matched!
  internalDetailedCategory: "Groceries"
}
```

---

### Step 3: Match Source Periods

**File:** `/utils/matchTransactionSplitsToSourcePeriods.ts`
**Purpose:** Populate period IDs for reporting and tracking

**Input:** Transactions with categories
**Output:** Transactions with period IDs populated

**Process:**
1. **CRITICAL:** Must run for ALL transactions
2. Queries all `source_periods` (app-wide, not user-specific)
3. Matches based on transaction date only
4. Populates: `monthlyPeriodId`, `weeklyPeriodId`, `biWeeklyPeriodId`
5. All splits get period IDs
6. Handles missing periods gracefully
7. In-memory processing with comprehensive logging

**Example:**
```typescript
// Transaction date: Jan 15, 2025

// Source periods matched:
- monthlyPeriodId: "2025-M01" (Jan 1-31)
- biWeeklyPeriodId: "2025-BM01" (Jan 1-15)
- weeklyPeriodId: "2025-W03" (Jan 13-19)

// Split after matching:
{
  splitId: "split_1",
  monthlyPeriodId: "2025-M01",
  weeklyPeriodId: "2025-W03",
  biWeeklyPeriodId: "2025-BM01",
  // ... other fields
}
```

---

### Step 4: Match Budgets

**File:** `/utils/matchTransactionSplitsToBudgets.ts`
**Purpose:** Assign transaction splits to user's budgets

**Input:** Transactions with period IDs
**Output:** Transactions with budgetId assigned to splits

**Process:**
1. Queries user's active budgets by date range
2. Finds budget containing transaction date
3. For ongoing budgets: checks start date only
4. For limited budgets: checks start AND end dates
5. Updates `split.budgetId` for all splits
6. Uses first matching budget (priority order)
7. Defaults to `'unassigned'` if no match

**Matching Logic:**
```typescript
// Find budget where:
budget.startDate <= transactionDate &&
(budget.isOngoing || budget.endDate >= transactionDate)

// Category matching (if categoryIds specified):
budget.categoryIds.includes(transaction.categoryId)

// First match wins
```

**Example:**
```typescript
// User's budgets
[
  {
    budgetId: "groceries",
    amount: 500,
    period: "monthly",
    categoryIds: ["food_groceries"],
    startDate: "2025-01-01",
    isOngoing: true
  },
  {
    budgetId: "dining",
    amount: 200,
    period: "monthly",
    categoryIds: ["food_restaurants"],
    startDate: "2025-01-01",
    isOngoing: true
  }
]

// Transaction
{
  transactionDate: "2025-01-15",
  categoryId: "food_groceries",
  splits: [{
    amount: 75,
    budgetId: null  // To be assigned
  }]
}

// After matching:
{
  splits: [{
    amount: 75,
    budgetId: "groceries"  // Matched!
  }]
}
```

---

## Transaction-to-Budget Assignment with "Everything Else" Catch-All

### Overview

Step 4 of the transaction processing pipeline assigns transaction splits to budget IDs. This includes a **catch-all "everything else" budget** to ensure no spending goes untracked.

### Matching Priority

**Order of operations:**
1. Query user's active budgets
2. **Separate system "everything else" budget from regular budgets**
3. Try regular budgets first (date range + category matching)
4. **If no match:** Assign to "everything else" system budget
5. **If still no match:** Leave as `budgetId: 'unassigned'`

### Implementation

**File:** `/src/functions/transactions/utils/matchTransactionSplitsToBudgets.ts`

**Key code sections:**

**Budget Separation (NEW):**
```typescript
// Line ~40
const regularBudgets = [];
let everythingElseBudget = null;

budgetsSnapshot.docs.forEach(doc => {
  const budgetData = doc.data();
  const budgetObj = {
    id: doc.id,
    startDate: budgetData.startDate,
    endDate: budgetData.endDate,
    budgetEndDate: budgetData.budgetEndDate,
    isOngoing: budgetData.isOngoing,
    categoryIds: budgetData.categoryIds || [],
    isSystemEverythingElse: budgetData.isSystemEverythingElse || false
  };

  if (budgetObj.isSystemEverythingElse) {
    everythingElseBudget = budgetObj;
  } else {
    regularBudgets.push(budgetObj);
  }
});
```

**Fallback Matching (NEW):**
```typescript
// Line ~80
transactions.forEach(transaction => {
  const transactionDate = transaction.date.toDate();

  // Step 1: Try regular budgets first (existing logic)
  let matchedBudget = null;
  for (const budget of regularBudgets) {
    const isAfterStart = transactionDate >= budget.startDate.toDate();
    let isWithinRange = false;

    if (budget.isOngoing) {
      isWithinRange = isAfterStart;
    } else {
      const budgetEnd = budget.budgetEndDate || budget.endDate;
      isWithinRange = isAfterStart && (transactionDate <= budgetEnd.toDate());
    }

    if (isWithinRange) {
      matchedBudget = budget;
      break;  // First match wins
    }
  }

  // Step 2: Fallback to "everything else" budget (NEW)
  if (!matchedBudget && everythingElseBudget) {
    matchedBudget = everythingElseBudget;
    console.log(`[matchTransactionSplitsToBudgets] Transaction ${transaction.id} assigned to "everything else" budget`);
  }

  // Step 3: Update splits with matched budget
  if (matchedBudget) {
    transaction.splits = transaction.splits.map(split => ({
      ...split,
      budgetId: matchedBudget.id,
      updatedAt: Timestamp.now()
    }));
    matchedCount++;
  } else {
    // No match found - remains 'unassigned'
    console.warn(`[matchTransactionSplitsToBudgets] Transaction ${transaction.id} has no matching budget`);
  }
});
```

### Matching Logic Details

**Regular Budgets:**
- Match by date range (transaction date within budget start/end)
- First matching budget wins
- Checked in query order

**"Everything Else" Budget:**
- Only checked if NO regular budget matched
- Always matches (no date or category restrictions)
- Acts as final catch-all

**Unassigned State:**
- Only occurs if "everything else" budget doesn't exist
- Graceful degradation for edge cases
- User should always have "everything else" budget (created on signup)

### Category Matching

**Regular Budgets:**
- Can have `categoryIds: ["food", "groceries"]` (specific categories)
- Currently NOT used for matching (only date range)
- **Future enhancement:** Add category filtering to matching logic

**"Everything Else" Budget:**
- Has `categoryIds: []` (empty array)
- Empty array means "all categories"
- Intentional design: it's a catch-all

### Budget Query

**Current query:**
```typescript
const budgetsQuery = db.collection('budgets')
  .where('createdBy', '==', createdBy)
  .where('isActive', '==', true);
```

**Optimization opportunity:**
- Could filter by date range to reduce budget set
- Trade-off: More complex query vs fewer budgets to iterate

### Edge Cases

**Multiple "everything else" budgets:**
- **Shouldn't happen:** User should only have one
- **If it happens:** First one found wins
- **Prevention:** Migration function checks for duplicates

**No "everything else" budget:**
- **Shouldn't happen:** Created on user signup
- **Graceful degradation:** Transactions remain `budgetId: 'unassigned'`
- **Detection:** Query by `isSystemEverythingElse + userId`

**Transaction already has budgetId:**
- Initial transaction creation sets `budgetId: 'unassigned'`
- This function overwrites with matched budget
- Existing budgetId is replaced (not merged)

### Performance Considerations

**Budget Query:**
- One query per user per transaction batch
- Fetches all active budgets at once
- Cached in memory for batch processing

**Matching Overhead:**
- Separating "everything else": O(n) where n = number of budgets
- Typical user has 5-20 budgets
- Overhead: < 1ms per transaction batch

**Logging:**
- Logs when transaction assigned to "everything else"
- Helps debugging and monitoring adoption
- Can be removed after stable release

### Related Functions

**Called by:**
- `createTransaction` (manual transaction creation)
- `syncPlaidTransactions` (Plaid import)
- `updateTransaction` (transaction modification)

**Calls:**
- Firestore budget queries
- Budget date range validation
- Split array manipulation

### Future Enhancements

**Category-based matching:**
- Add category filtering to regular budget matching
- Match budget.categoryIds with transaction.category
- Falls back to "everything else" if no category match

**Priority/ordering:**
- Allow users to set budget priority
- Check high-priority budgets before low-priority
- "Everything else" always lowest priority

**Group-aware matching:**
- Check transaction.groupId
- Match to shared "everything else" budget if in group context
- Match to personal "everything else" if not in group

### Testing

**Test cases:**
1. Transaction matches regular budget → assigned to that budget
2. Transaction doesn't match any budget → assigned to "everything else"
3. Transaction date outside all budget ranges → assigned to "everything else"
4. User has no "everything else" budget → remains unassigned (edge case)
5. Multiple budgets match → first one wins (before "everything else")

**Test data:**
```typescript
// Regular budget: Jan 1 - Dec 31
// Everything else: ongoing (always active)
// Transaction: Feb 15 → should match regular budget
// Transaction: Next year → should match "everything else"
```

---

### Step 5: Match Outflows

**File:** `/utils/matchTransactionSplitsToOutflows.ts`
**Purpose:** Match transactions to recurring bills (outflows)

**Input:** Transactions with budget assignments
**Output:** Transactions with outflowId + list of outflow period updates

**Process:**
1. Queries `outflow_periods` within ±3 month window
2. Uses intelligent matching algorithm (see below)
3. Skips outflow periods already paid (`isPaid: true`)
4. Creates list of updates for batch application
5. Returns modified transactions + pending updates

**Scoring Algorithm:**
```typescript
// Merchant Name Matching: +50 points
if (outflowPeriod.merchantName includes transaction.merchantName) {
  score += 50;
}

// Amount Matching (±10% tolerance): +30 points
const amountDiff = abs(transaction.amount - outflowPeriod.averageAmount);
const tolerance = outflowPeriod.averageAmount * 0.10;
if (amountDiff <= tolerance) {
  score += 30;
}

// Date Proximity (±7 days): +20 points (decreases with distance)
const daysDiff = abs(transaction.date - outflowPeriod.dueDate);
if (daysDiff <= 7) {
  score += (20 * (7 - daysDiff) / 7);
}

// Minimum threshold: 50 points to match
if (score >= 50) {
  // Match!
}
```

**Example:**
```typescript
// Outflow period
{
  outflowId: "electricity",
  merchantName: "ConEd",
  averageAmount: 125.00,
  dueDate: "2025-01-20",
  isPaid: false
}

// Transaction
{
  merchantName: "ConEd Energy",
  amount: 123.50,
  transactionDate: "2025-01-18"
}

// Scoring:
// - Merchant match: +50 (ConEd in "ConEd Energy")
// - Amount match: +30 ($123.50 within 10% of $125)
// - Date match: +17 (2 days difference)
// Total: 97 points ✓ (threshold: 50)

// Result: Match!
{
  splits: [{
    outflowId: "electricity",
    budgetId: "utilities"  // May also have budget
  }]
}
```

---

### Step 6: Batch Create

**File:** `/utils/batchCreateTransactions.ts`
**Purpose:** Atomically write transactions and updates to Firestore

**Input:** Transactions + outflow updates
**Output:** Count of created transactions

**Process:**
1. Uses Firestore batch operations (atomic writes)
2. Handles 500-item batch limit (splits into multiple if needed)
3. Creates transactions in `transactions` collection
4. Updates `outflow_periods` with transaction references
5. Adds `transactionSplits` array to periods
6. Sets period status to 'paid' when matched
7. Comprehensive logging with diagnostics

**Batch Structure:**
```typescript
const batch = db.batch();

// Add transactions
transactions.forEach(transaction => {
  const ref = db.collection('transactions').doc();
  batch.set(ref, transaction);
});

// Update outflow periods
outflowUpdates.forEach(update => {
  const ref = db.collection('outflow_periods').doc(update.periodId);
  batch.update(ref, {
    transactionSplits: arrayUnion(update.splitId),
    isPaid: true,
    paidDate: transaction.transactionDate
  });
});

// Commit atomically
await batch.commit();
```

---

## Budget Integration

### How Splits Are Assigned to Budgets

**Default Behavior:**
1. Transaction created with one split (full amount)
2. `matchTransactionSplitsToBudgets()` queries user's budgets
3. Finds budget where transaction date falls within budget period
4. Sets `split.budgetId` to matched budget
5. If no match: `budgetId: 'unassigned'`

**Date Range Matching:**
```typescript
// Budget
{
  startDate: "2025-01-01",
  endDate: "2025-12-31",  // or undefined if ongoing
  isOngoing: true
}

// Transaction
{
  transactionDate: "2025-01-15"
}

// Check:
if (transactionDate >= budget.startDate &&
    (budget.isOngoing || transactionDate <= budget.endDate)) {
  // Match!
}
```

**Category Filtering (Optional):**
```typescript
// Budget
{
  categoryIds: ["food_groceries", "food_restaurants"]
}

// Transaction
{
  categoryId: "food_groceries"
}

// Check:
if (budget.categoryIds.includes(transaction.categoryId)) {
  // Match!
}
```

---

### Budget Spending Updates

**Trigger:** `onTransactionCreate`, `onTransactionUpdate`, `onTransactionDelete`

**Flow:**
```
1. Transaction event fires
   ↓
2. Trigger extracts splits and budgetIds
   ↓
3. For each budgetId, calculate spending delta
   ↓
4. Find matching budget_periods by date
   ↓
5. Update period.spent atomically
   ↓
6. Calculate period.remaining (allocatedAmount - spent)
```

**Update Logic:**
```typescript
// Find all budget periods containing transaction date
const periods = await db.collection('budget_periods')
  .where('budgetId', '==', split.budgetId)
  .where('periodStart', '<=', transactionDate)
  .where('periodEnd', '>=', transactionDate)
  .get();

// Update all matching periods
const batch = db.batch();
periods.forEach(period => {
  const newSpent = (period.spent || 0) + split.amount;
  const newRemaining = period.allocatedAmount - newSpent;

  batch.update(period.ref, {
    spent: newSpent,
    remaining: newRemaining,
    lastCalculated: Timestamp.now()
  });
});

await batch.commit();
```

**Example:**
```typescript
// Transaction: $50 on Jan 15 in Groceries budget

// Matches:
- Monthly period (Jan 1-31): spent +$50
- Bi-monthly period (Jan 1-15): spent +$50
- Weekly period (Jan 13-19): spent +$50

// All three updated atomically
```

---

## Category Mapping

### Category Mapper System

**File:** `/utils/categoryMapper.ts`
**Caching:** 5-minute TTL cache to reduce Firestore queries

**Mapping Priority:**
1. **Detailed Plaid Category** (most specific)
   - Example: `FOOD_AND_DRINK_COFFEE_SHOPS`
2. **Primary Plaid Category** (fallback)
   - Example: `FOOD_AND_DRINK`
3. **Legacy Keyword Matching** (case-insensitive)
   - Example: "starbucks" → Coffee category
4. **Default:** `OTHER_EXPENSE`

**Cache Behavior:**
```typescript
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// First call: Query Firestore
const categories = await db.collection('categories').get();
cache.set(categories, Date.now());

// Subsequent calls (within 5 min): Use cache
if (Date.now() - cache.timestamp < CACHE_TTL) {
  return cache.categories;
}
```

**Category Document Structure:**
```typescript
{
  name: "Groceries",
  type: "Outflow",
  primary_plaid_category: "FOOD_AND_DRINK",
  detailed_plaid_category: "FOOD_AND_DRINK_GROCERIES",
  merchants: ["Whole Foods", "Trader Joe's", "Safeway"],
  keywords: ["grocery", "groceries", "supermarket"]
}
```

---

## Usage Examples

### Example 1: Create Manual Transaction

```typescript
// HTTP POST /transactions/create
const request = {
  amount: 75.00,
  description: "Grocery shopping",
  transactionDate: "2025-01-15",
  accountId: "account_checking",
  type: "EXPENSE",
  merchantName: "Whole Foods"
};

// Response
{
  success: true,
  transactionId: "txn_abc123"
}

// Automatic processing:
// 1. Default split created (full $75)
// 2. Matched to "Groceries" budget (if exists)
// 3. Source periods populated (monthly/weekly/bi-weekly)
// 4. Trigger updates budget_periods.spent
```

---

### Example 2: Update Transaction (Change Amount)

```typescript
// HTTP PUT /transactions/update/txn_abc123
const request = {
  amount: 85.00  // Changed from $75 to $85
};

// Automatic recalculation:
// 1. onTransactionUpdate trigger fires
// 2. Calculates delta: +$10
// 3. Finds budget periods for transaction date
// 4. Updates all matching periods:
//    - Monthly: spent +$10
//    - Bi-monthly: spent +$10
//    - Weekly: spent +$10
```

---

### Example 3: Approve Pending Transaction

```typescript
// HTTP POST /transactions/approve/txn_abc123
const request = {
  status: "APPROVED"
};

// Response
{
  success: true,
  message: "Transaction approved"
}

// Updated document:
{
  transactionStatus: "APPROVED",
  approvedBy: "user_xyz",
  approvedAt: "2025-01-15T10:30:00Z"
}
```

---

### Example 4: Full Pipeline (Plaid Integration)

```typescript
// Plaid returns transactions
const plaidTransactions = [
  {
    transaction_id: "plaid_123",
    amount: 50.00,
    merchant_name: "Starbucks",
    date: "2025-01-15",
    personal_finance_category: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_COFFEE_SHOPS"
    }
  }
];

// Step 1: Format
const formatted = formatTransactions(plaidTransactions, accounts);

// Step 2: Enhance Categories
const categorized = matchCategoriesToTransactions(formatted);
// Result: internalPrimaryCategory = "Coffee"

// Step 3: Match Source Periods
const withPeriods = matchTransactionSplitsToSourcePeriods(categorized);
// Result: monthlyPeriodId = "2025-M01", etc.

// Step 4: Match Budgets
const withBudgets = matchTransactionSplitsToBudgets(withPeriods, userId);
// Result: budgetId = "coffee_budget" (if exists)

// Step 5: Match Outflows
const { transactions: withOutflows, updates } =
  matchTransactionSplitsToOutflows(withBudgets);
// Result: outflowId = null (not a bill)

// Step 6: Batch Create
const count = await batchCreateTransactions(withOutflows, updates);
// Result: 1 transaction created

// Trigger fires → Budget periods updated
```

---

## Security & Access Control

### Transaction Authorization

**Read Operations:**
```typescript
// User can read if:
- transaction.ownerId === userId (owner)
- transaction.groupId && user is in group
```

**Create Operations:**
```typescript
// User can create if:
- user has VIEWER role minimum
- user is authenticated
```

**Update Operations:**
```typescript
// User can update if:
- transaction.ownerId === userId (owner)
- user has ADMIN role
```

**Delete Operations:**
```typescript
// User can delete if:
- transaction.ownerId === userId (owner)
- user has ADMIN role
```

**Approve Operations:**
```typescript
// User can approve if:
- user has EDITOR role minimum
- transaction.status === 'PENDING'
```

---

### Field Validation

**Transaction Creation:**
```typescript
- amount: required, number, > 0
- description: required, string, max 200 chars
- transactionDate: required, valid date
- accountId: required, valid account ID
- type: required, enum ['INCOME', 'EXPENSE', 'TRANSFER']
```

**Transaction Update:**
```typescript
- amount: optional, number, > 0
- description: optional, string, max 200 chars
- Cannot change: transactionId, createdBy, source
```

**Split Validation:**
```typescript
- budgetId: required, string
- amount: required, number
- Sum of split amounts must equal transaction amount
- Maximum 10 splits per transaction
```

---

## Development Guidelines

### Adding New Cloud Functions

1. **Create function file** in `/api/crud/`
2. **Use existing patterns:**
   ```typescript
   import { onRequest } from 'firebase-functions/v2/https';

   export const myFunction = onRequest(
     { cors: true, memory: '256MiB', timeoutSeconds: 30 },
     async (req, res) => {
       try {
         // Validate auth
         // Process request
         // Return response
       } catch (error) {
         res.status(500).json({ success: false, message: error.message });
       }
     }
   );
   ```
3. **Export** from `/index.ts`

---

### Extending the Pipeline

**To add a new step:**

1. Create utility file in `/utils/`
2. Follow naming pattern: `match[Entity]To[Target].ts`
3. Input: Transactions array
4. Output: Modified transactions array
5. Update `createTestTransactions` to include new step
6. Document in pipeline section

**Example:**
```typescript
// utils/matchTransactionToPaymentMethods.ts
export async function matchTransactionToPaymentMethods(
  transactions: Transaction[]
): Promise<Transaction[]> {
  // Query payment methods
  // Match by criteria
  // Populate transaction.paymentMethodId
  return transactions;
}
```

---

### Batch Operations Best Practices

**Firestore Limits:**
- Maximum 500 documents per batch
- Use `batchCreateTransactions()` utility
- Splits into multiple batches automatically

**Example:**
```typescript
const batches = chunk(transactions, 500);

for (const batch of batches) {
  const firestoreBatch = db.batch();
  batch.forEach(txn => {
    const ref = db.collection('transactions').doc();
    firestoreBatch.set(ref, txn);
  });
  await firestoreBatch.commit();
}
```

---

### Logging Best Practices

**Use emoji indicators:**
```typescript
console.log('✅ Transaction created:', transactionId);
console.log('📊 Budget updated:', { budgetId, spent });
console.log('🔄 Processing batch:', batchNumber);
console.log('❌ Error occurred:', error.message);
```

**Include context:**
```typescript
console.log('[createTransaction] User:', userId, 'Amount:', amount);
console.log('[updateBudgetSpending] Delta:', delta, 'Periods:', count);
```

---

## Known Issues & TODOs

### Current Limitations

1. **No Transaction Split UI** - Backend supports but mobile app doesn't create them
2. **Outflow Matching Limited** - Only matches to `outflow_periods`, not recurring bills directly
3. **No Multi-Group Support** - Splits assigned to single budgets (though transaction has groupId)
4. **No Real-Time Updates** - No websocket-based updates for approvals
5. **Category Override UI** - Backend supports but frontend implementation unknown
6. **No Dispute/Refund Workflow** - Status is simple (pending/approved/rejected)
7. **No Transaction Rules Engine** - `split.rules` array present but not utilized
8. **No Tag Management UI** - Tags supported in splits but no frontend management
9. **No Batch Import** - Only Plaid and manual creation supported
10. **Limited Validation** - Some fields optional (description, internal categories)

---

### Missing Features (Future Enhancements)

#### Query Functions Needed:
- `getTransactionsByBudgetPeriod` - Get all transactions for a budget period
- `getUnassignedTransactions` - Find transactions with budgetId='unassigned'
- `getBudgetsForTransaction` - Get eligible budgets for reassignment

#### Assignment Functions Needed:
- `reassignTransactionSplit` - Change budget assignment
- `assignUnassignedTransaction` - Assign unassigned transaction to budget
- `bulkReassignTransactions` - Batch reassign multiple transactions

#### Splitting Functions Needed:
- `splitTransaction` - Split transaction across multiple budgets
- `mergeSplits` - Merge multiple splits back to single
- `updateSplit` - Modify individual split amount or budget

#### Analytics Functions Needed:
- Transaction trends over time
- Spending by category breakdown
- Budget vs actual comparisons

#### Automation Enhancements:
- Transaction matching rules (custom user rules for category/budget assignment)
- Duplicate detection and merging
- Smart categorization (ML-based)
- Transaction templates for recurring manual entries

---

## Database Dependencies

### Required Collections

- `transactions` - Transaction documents
- `budgets` - For budget assignment
- `budget_periods` - For spending updates
- `source_periods` - For period ID population
- `outflow_periods` - For bill matching
- `categories` - For category mapping
- `accounts` - For Plaid account lookup
- `users` - For user context and access control

---

### Required Firestore Indexes

```javascript
// transactions collection
transactions(ownerId, transactionDate DESC)
transactions(ownerId, transactionStatus, transactionDate DESC)
transactions(groupId, transactionDate DESC)
transactions(accountId, transactionDate DESC)

// Composite for split queries
transactions(splits.budgetId, transactionDate DESC)
transactions(splits.outflowId, transactionDate DESC)
```

---

## Performance Considerations

### Optimization Strategies

1. **Category Mapping Cache:** 5-minute TTL reduces Firestore queries
2. **Batch Operations:** Handles 500+ documents efficiently
3. **Non-Blocking Budget Updates:** Errors logged, don't fail transactions
4. **Indexed Queries:** All common query patterns have composite indexes

### Scaling Considerations

**Current Limits:**
- 500 documents per batch operation
- 10 splits per transaction (reasonable limit)
- 5-minute category cache TTL

**Future Optimizations:**
- Pagination for large transaction lists
- Archive old transactions (>1 year)
- Lazy loading of transaction details
- Real-time websocket updates

---

## Summary Statistics

- **Total Cloud Functions:** 8 (5 CRUD + 3 triggers)
- **Pipeline Steps:** 6 sequential transformations
- **Data Collections:** 8 dependent collections
- **Batch Size Limit:** 500 documents
- **Category Cache TTL:** 5 minutes
- **Max Splits Per Transaction:** 10 (recommended)
- **Outflow Match Threshold:** 50 points minimum

---

**Last Updated:** January 2026
**Version:** 1.0
**Maintainer:** Family Finance Team
