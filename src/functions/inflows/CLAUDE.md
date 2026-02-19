# Inflows System - Cloud Functions

## Overview

The Inflows System is a **recurring income management module** that enables users to track, predict, and monitor recurring income streams (salaries, commissions, bonuses, freelance payments) with automatic period-based withholding calculations and **per-occurrence payment tracking**. It supports both Plaid-synced recurring transactions and user-created income entries, with automatic period generation and financial planning features.

### Core Concept: Three-Module Architecture

The Inflows System is organized into **three domain-specific modules**, each with clear responsibilities:

1. **`inflow_main`** - Recurring Income Definitions
   - Manages Plaid-detected and user-created recurring income
   - Stores income details (amount, frequency, payer/employer)
   - Handles Plaid stream synchronization
   - Triggers period generation

2. **`inflow_periods`** - Withholding Instances & Occurrence Tracking
   - Creates period-specific income allocations
   - Calculates daily withholding rates (for budgeting)
   - **Tracks individual income occurrences within periods**
   - **Matches received payments to specific occurrences**
   - Primary user interaction point for income planning

3. **`inflow_summaries`** - Period-Centric Aggregations
   - Aggregates inflow periods by source period
   - Provides period-centric views for users
   - Powers summary tiles and dashboards
   - Maintains denormalized summary data

---

## Architecture

### Module Structure

```
inflows/
├── index.ts                    # Main module exports
├── CLAUDE.md                   # This documentation
│
├── inflow_main/                # MODULE 1: Recurring Income Definitions
│   ├── __tests__/              # Unit tests for inflow_main
│   ├── admin/                  # Admin utilities
│   │   └── index.ts
│   ├── api/                    # Public API endpoints
│   │   └── index.ts
│   ├── crud/                   # Create/Read/Update/Delete operations
│   │   ├── createManualInflow.ts
│   │   └── index.ts
│   ├── dev/                    # Development and testing functions
│   │   ├── createTestInflows.ts
│   │   └── index.ts
│   ├── triggers/               # Firestore triggers
│   │   ├── onInflowCreated.ts
│   │   ├── onInflowUpdated.ts
│   │   └── index.ts
│   ├── types/                  # Type definitions
│   │   └── index.ts
│   └── utils/                  # Inflow-specific utilities
│       ├── formatRecurringInflows.ts
│       ├── enhanceRecurringInflows.ts
│       ├── classifyIncomeType.ts
│       └── index.ts
│
├── inflow_periods/             # MODULE 2: Income Instances & Occurrence Tracking
│   ├── __tests__/              # Unit tests for inflow_periods
│   │   ├── alignTransactionsToInflowPeriods.test.ts
│   │   ├── predictNextPayment.test.ts
│   │   ├── calculateAllOccurrencesInPeriod.test.ts
│   │   └── calculateInflowPeriodStatus.test.ts
│   ├── admin/                  # Admin utilities
│   │   └── index.ts
│   ├── api/                    # Public API endpoints
│   │   ├── markIncomeReceived.ts
│   │   ├── assignTransactionToInflow.ts
│   │   └── index.ts
│   ├── crud/                   # CRUD operations
│   │   ├── createInflowPeriods.ts
│   │   └── index.ts
│   ├── triggers/               # Firestore triggers
│   │   ├── onInflowPeriodCreate.ts
│   │   ├── onInflowPeriodUpdate.ts
│   │   ├── onInflowPeriodDelete.ts
│   │   └── index.ts
│   ├── types/                  # Type definitions
│   │   └── index.ts
│   └── utils/                  # Period-specific utilities
│       ├── alignTransactionsToInflowPeriods.ts    # NEW: Core transaction matching
│       ├── predictNextPayment.ts                   # NEW: Payment prediction
│       ├── calculateAllOccurrencesInPeriod.ts      # Occurrence calculation
│       ├── calculateInflowPeriodStatus.ts          # Status determination
│       ├── batchCreateInflowPeriods.ts
│       └── index.ts
│
└── inflow_summaries/           # MODULE 3: Period-Centric Aggregations
    ├── __tests__/              # Unit tests for summaries
    ├── crud/                   # CRUD operations
    │   └── index.ts
    └── utils/                  # Summary-specific utilities
        └── index.ts
```

---

## Data Models

### Inflow Document (Recurring Income Definition)

**Collection:** `inflows`
**Managed by:** `inflow_main` module

```typescript
interface Inflow {
  // === DOCUMENT IDENTITY ===
  id: string;                          // Plaid stream_id or user-generated ID

  // === OWNERSHIP & ACCESS (Query-Critical) ===
  ownerId: string;                     // userId of creator
  createdBy: string;                   // userId of creator
  updatedBy: string;                   // userId of last updater
  groupId: string | null;              // Family/group association

  // === PLAID IDENTIFIERS (null for manual entries) ===
  plaidItemId: string | null;          // Plaid item ID
  accountId: string | null;            // Plaid account ID

  // === FINANCIAL DATA ===
  lastAmount: number;                  // Last amount received (always positive)
  averageAmount: number;               // Average amount (rolling average)
  currency: string;                    // ISO currency code (e.g., "USD")
  unofficialCurrency: string | null;   // Unofficial currency code

  // === DESCRIPTIVE INFO ===
  description: string | null;          // Description from Plaid or user
  payerName: string | null;            // Employer, client, or payer name
  userCustomName: string | null;       // User custom name override

  // === TEMPORAL DATA ===
  frequency: PlaidRecurringFrequency;  // WEEKLY, BIWEEKLY, SEMI_MONTHLY, MONTHLY, ANNUALLY
  firstDate: Timestamp;                // First occurrence
  lastDate: Timestamp;                 // Last occurrence
  predictedNextDate: Timestamp | null; // Predicted next (from Plaid or calculated)

  // === CATEGORIZATION ===
  plaidPrimaryCategory: string;        // e.g., "INCOME"
  plaidDetailedCategory: string;       // e.g., "INCOME_WAGES"
  internalPrimaryCategory: string | null;   // User override
  internalDetailedCategory: string | null;  // User override

  // === INCOME CLASSIFICATION ===
  incomeType: IncomeType;              // salary, hourly, commission, bonus, etc.
  isRegularSalary: boolean;            // True for consistent salary payments
  isVariable: boolean;                 // True for variable income (hourly, commission)
  variableIncomeConfig?: {
    useRollingAverage: boolean;        // Use rolling average for prediction
    rollingAveragePeriods: number;     // Number of periods to average (default: 3)
    userOverrideAmount: number | null; // User's manual estimate
  };

  // === BONUS/COMMISSION TRACKING ===
  bonusConfig?: {
    schedule: 'annual' | 'quarterly' | 'monthly' | 'performance' | 'custom';
    expectedMonth?: number;            // 1-12 for annual bonuses
    expectedQuarter?: number;          // 1-4 for quarterly bonuses
    lastBonusAmount?: number;
    lastBonusDate?: Timestamp;
  };

  commissionConfig?: {
    schedule: 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
    expectedPaymentDay?: number;       // Day of month when paid
    basePlusCommission: boolean;       // True if salary + commission
    baseAmount?: number;               // Base salary portion
  };

  // === STATUS & CONTROL ===
  source: 'plaid' | 'manual';          // Source of this inflow
  isActive: boolean;                   // Whether actively tracking
  isHidden: boolean;                   // User visibility control
  isUserModified: boolean;             // User has modified Plaid data
  plaidStatus: string | null;          // MATURE, EARLY_DETECTION, etc.
  plaidConfidenceLevel: string | null; // Plaid's confidence in categorization

  // === TRANSACTION REFERENCES ===
  transactionIds: string[];            // Linked Plaid transaction IDs

  // === USER INTERACTION ===
  tags: string[];                      // User-defined tags
  rules: any[];                        // User or system rules

  // === AUDIT TRAIL ===
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastSyncedAt: Timestamp | null;      // Last Plaid sync
}

// Income Type Classification
enum IncomeType {
  SALARY = 'salary',           // Regular fixed salary
  HOURLY = 'hourly',           // Variable hours-based
  COMMISSION = 'commission',   // Sales/performance-based
  BONUS = 'bonus',             // Periodic bonuses
  FREELANCE = 'freelance',     // Contract/gig work
  INVESTMENT = 'investment',   // Dividends, interest
  RENTAL = 'rental',           // Property income
  PENSION = 'pension',         // Retirement income
  GOVERNMENT = 'government',   // Benefits, tax refunds
  OTHER = 'other'
}
```

### Inflow Period Document (Income Instance)

**Collection:** `inflow_periods`
**Managed by:** `inflow_periods` module

```typescript
interface InflowPeriod {
  // === IDENTITY ===
  id: string;                           // Format: "{inflowId}_{sourcePeriodId}"
  inflowId: string;                     // Reference to parent inflow
  sourcePeriodId: string;               // Reference to source_periods

  // === OWNERSHIP & ACCESS (Query-Critical) ===
  ownerId: string;
  createdBy: string;
  updatedBy: string;
  groupId: string | null;

  // === PLAID IDENTIFIERS ===
  accountId: string | null;
  plaidItemId: string | null;

  // === FINANCIAL TRACKING ===
  actualAmount: number | null;          // Actual received (null until transaction attached)
  amountWithheld: number;               // For budgeting: daily rate × period days
  averageAmount: number;                // Expected per occurrence
  expectedAmount: number;               // Total expected for period
  amountPerOccurrence: number;          // Single income amount
  totalAmountDue: number;               // Total expected (occurrences × amount)
  totalAmountPaid: number;              // Sum of received amounts
  totalAmountUnpaid: number;            // Calculated: due - received

  // === TIMESTAMPS ===
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastCalculated: Timestamp;

  // === PAYMENT CYCLE INFO ===
  currency: string;
  cycleDays: number;                    // Days between payments
  cycleStartDate: Timestamp;
  cycleEndDate: Timestamp;
  dailyWithholdingRate: number;         // For budgeting calculations

  // === INFLOW METADATA (Denormalized) ===
  description: string;
  frequency: string;
  incomeType: IncomeType;
  isRegularSalary: boolean;

  // === PAYMENT STATUS ===
  isPaid: boolean;                      // Legacy: same as isFullyPaid
  isFullyPaid: boolean;                 // All occurrences received
  isPartiallyPaid: boolean;             // Some but not all received
  isReceiptPeriod: boolean;             // True if ANY occurrence due this period

  // === CATEGORIZATION ===
  internalDetailedCategory: string | null;
  internalPrimaryCategory: string | null;
  plaidPrimaryCategory: string;
  plaidDetailedCategory: string;

  // === STATUS & CONTROL ===
  isActive: boolean;
  isHidden: boolean;

  // === PAYER INFO ===
  payerName: string | null;             // Employer/client name
  userCustomName: string | null;

  // === PERIOD CONTEXT ===
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;
  periodType: PeriodType;               // "weekly" | "monthly" | "bi_monthly"

  // === PREDICTION ===
  predictedNextDate: Timestamp | null;

  // === USER INTERACTION ===
  rules: any[];
  tags: string[];
  note: string | null;

  // === SOURCE ===
  source: 'plaid' | 'manual';

  // === TRANSACTION TRACKING ===
  transactionIds: string[];             // All matched transaction IDs

  // === MULTI-OCCURRENCE TRACKING ===
  numberOfOccurrencesInPeriod: number;  // How many income events this period
  numberOfOccurrencesPaid: number;      // How many have been received
  numberOfOccurrencesUnpaid: number;    // Calculated: total - paid
  occurrenceDueDates: Timestamp[];      // Array of expected dates
  occurrencePaidFlags: boolean[];       // Parallel array: which received
  occurrenceTransactionIds: (string | null)[]; // Parallel array: transaction IDs
  occurrenceAmounts: number[];          // Parallel array: actual amounts received

  // === PROGRESS METRICS ===
  paymentProgressPercentage: number;    // (paid / total) × 100 (unit count)
  dollarProgressPercentage: number;     // ($ received / $ expected) × 100

  // === DUE DATE TRACKING ===
  firstDueDateInPeriod: Timestamp | null;
  lastDueDateInPeriod: Timestamp | null;
  nextUnpaidDueDate: Timestamp | null;
}
```

---

## Core Utility Functions

### 1. AlignTransactionsToInflowPeriods

**Purpose:** Match Plaid transaction IDs to the correct inflow_period documents

**Location:** `inflow_periods/utils/alignTransactionsToInflowPeriods.ts`

```typescript
/**
 * Auto-Match Transaction to Inflow Periods
 *
 * Matches inflow's historical transactions to appropriate inflow periods.
 * Called by onInflowCreated trigger after periods are generated, and
 * by onInflowUpdated when new transaction IDs are added.
 *
 * Matching logic:
 * 1. Get all transactions referenced in inflow.transactionIds
 * 2. For each transaction, find the matching inflow period based on transaction date
 * 3. Match to ALL THREE period types (monthly, weekly, bi-weekly)
 * 4. Determine which occurrence the transaction satisfies
 * 5. Update occurrence arrays (occurrencePaidFlags, occurrenceTransactionIds, occurrenceAmounts)
 * 6. Recalculate period totals and status
 */
export async function alignTransactionsToInflowPeriods(
  db: FirebaseFirestore.Firestore,
  inflowId: string,
  inflow: Inflow,
  createdPeriodIds: string[]
): Promise<AlignmentResult>;

interface AlignmentResult {
  transactionsProcessed: number;
  transactionsMatched: number;
  periodsUpdated: number;
  errors: string[];
}
```

**Algorithm:**
1. Fetch all transactions by Plaid transaction IDs from `transactions` collection
2. For each transaction:
   - Determine transaction date
   - Find matching inflow periods (monthly, weekly, bi-weekly) where date falls within period
   - For each matching period:
     - Find the appropriate occurrence based on date proximity
     - Update `occurrencePaidFlags[index] = true`
     - Update `occurrenceTransactionIds[index] = transactionId`
     - Update `occurrenceAmounts[index] = Math.abs(transaction.amount)`
3. Recalculate totals (`totalAmountPaid`, `totalAmountUnpaid`)
4. Update payment status (`isFullyPaid`, `isPartiallyPaid`)

### 2. PredictNextPayment

**Purpose:** Calculate when the next income payment will be received

**Location:** `inflow_periods/utils/predictNextPayment.ts`

```typescript
/**
 * Predict Next Payment Date and Amount
 *
 * Calculates when the next income payment will be received and the expected amount.
 * Handles various income types including salary, commission, and bonuses.
 *
 * For variable income:
 * - Uses rolling average if configured
 * - Falls back to user override if set
 * - Otherwise uses Plaid's average amount
 */
export function predictNextPayment(
  inflow: Inflow,
  fromDate: Date = new Date()
): PaymentPrediction;

interface PaymentPrediction {
  expectedDate: Timestamp;
  expectedAmount: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  predictionMethod: 'plaid' | 'frequency' | 'rolling_average' | 'user_override';
  isInPeriod: boolean;              // Is the payment expected within current viewing period?
  daysUntilPayment: number;
}

/**
 * Predict All Payments in Period
 *
 * For a given viewing period (e.g., monthly budget view), predict all
 * expected income payments including their dates and amounts.
 */
export function predictPaymentsInPeriod(
  inflow: Inflow,
  periodStart: Date,
  periodEnd: Date
): PaymentPrediction[];
```

**Frequency Handling:**
```typescript
function addFrequencyInterval(date: Date, frequency: PlaidRecurringFrequency): Date {
  switch (frequency) {
    case 'WEEKLY': return addDays(date, 7);
    case 'BIWEEKLY': return addDays(date, 14);
    case 'SEMI_MONTHLY': return addDays(date, 15); // Approximate
    case 'MONTHLY': return addMonths(date, 1);
    case 'QUARTERLY': return addMonths(date, 3);
    case 'SEMI_ANNUALLY': return addMonths(date, 6);
    case 'ANNUALLY': return addYears(date, 1);
  }
}
```

**Variable Income Prediction:**
```typescript
function predictVariableIncomeAmount(inflow: Inflow): number {
  const config = inflow.variableIncomeConfig;

  // Priority 1: User override
  if (config?.userOverrideAmount) {
    return config.userOverrideAmount;
  }

  // Priority 2: Rolling average
  if (config?.useRollingAverage) {
    return calculateRollingAverage(inflow, config.rollingAveragePeriods);
  }

  // Priority 3: Plaid average
  return inflow.averageAmount;
}
```

### 3. CalculateAllOccurrencesInPeriod

**Purpose:** Calculate all income occurrences within a period

**Location:** `inflow_periods/utils/calculateAllOccurrencesInPeriod.ts`

```typescript
/**
 * Calculate All Occurrences In Period
 *
 * Determines how many times an income is expected within a given period.
 * Generates occurrence details including due dates.
 *
 * Examples:
 * - Bi-weekly salary in monthly period: 2-3 occurrences
 * - Weekly income in monthly period: 4-5 occurrences
 * - Monthly salary in monthly period: 1 occurrence (if due date in period)
 */
export function calculateAllOccurrencesInPeriod(
  inflow: Inflow,
  sourcePeriod: SourcePeriod,
  cycleInfo: CycleInfo
): OccurrenceResult;

interface OccurrenceResult {
  numberOfOccurrences: number;
  occurrenceDueDates: Timestamp[];
  totalExpectedAmount: number;
}
```

### 4. CalculateInflowPeriodStatus

**Purpose:** Determine the payment status of an inflow period

**Location:** `inflow_periods/utils/calculateInflowPeriodStatus.ts`

```typescript
/**
 * Calculate Inflow Period Status
 *
 * Determines the status of an inflow period based on:
 * - Whether period has income due
 * - How many occurrences have been received
 * - Due dates vs current date
 */
export function calculateInflowPeriodStatus(
  inflowPeriod: InflowPeriod
): InflowPeriodStatus;

enum InflowPeriodStatus {
  RECEIVED = 'received',           // All occurrences received
  PARTIAL = 'partial',             // Some occurrences received
  PENDING = 'pending',             // Expecting income, not yet received
  OVERDUE = 'overdue',             // Expected date passed, not received
  NOT_EXPECTED = 'not_expected'    // No income expected this period
}
```

---

## Common Workflows

### 1. Plaid Inflow Detection and Period Creation

```
Plaid Webhook: Recurring transactions detected
    ↓
syncRecurringTransactions()
    ↓
formatRecurringInflows() - Step 1: Convert Plaid format
    ↓
enhanceRecurringInflows() - Step 2: Add income classification
    ↓
batchCreateRecurringStreams() - Step 3: Upsert to Firestore
    ↓
[TRIGGER] onInflowCreated
    ↓
createInflowPeriodsFromSource()
    ↓
For each source period:
    calculateAllOccurrencesInPeriod()
        ↓
    Build period document
    ↓
Batch write to /inflow_periods/
    ↓
alignTransactionsToInflowPeriods()
    ↓
Match historical transactions to occurrences
    ↓
Update user_summary via triggers
```

### 2. Manual Income Creation

```
User Action: Create Manual Income
    ↓
createManualInflow (Callable)
    ↓
Validate and classify income type
    ↓
Write to /inflows/{inflowId}
    ↓
[TRIGGER] onInflowCreated
    ↓
Generate inflow_periods (3 months forward)
    ↓
User can now see expected income in budget
```

### 3. Marking Income as Received

```
User Action: Mark Income Received
    ↓
markIncomeReceived (Callable)
    ↓
OR
    ↓
User assigns transaction split to inflow
    ↓
assignTransactionToInflow (Callable)
    ↓
Find matching inflow periods (all 3 types)
    ↓
Match to specific occurrence
    ↓
Update occurrence arrays:
    - occurrencePaidFlags[index] = true
    - occurrenceTransactionIds[index] = transactionId
    - occurrenceAmounts[index] = actualAmount
    ↓
Recalculate totals and status
    ↓
[TRIGGER] onInflowPeriodUpdate
    ↓
Update user_summary
```

---

## User Summary Integration

### Summary Fields for Income

```typescript
interface InflowSummaryData {
  // === TOTALS ===
  totalExpectedIncome: number;     // All expected income this period
  totalReceivedIncome: number;     // All received income this period
  totalPendingIncome: number;      // Income not yet received

  // === COUNTS ===
  totalCount: number;              // Total inflows with periods
  receiptPeriodCount: number;      // How many have income expected
  fullyReceivedCount: number;      // How many fully received
  pendingCount: number;            // How many pending

  // === BY INCOME TYPE ===
  byIncomeType: {
    [key in IncomeType]?: {
      expected: number;
      received: number;
      count: number;
    };
  };

  // === NEXT PAYMENT PREDICTION ===
  nextPaymentDate: Timestamp | null;
  nextPaymentAmount: number | null;
  nextPaymentSource: string | null;  // Payer name

  // === DETAILED ENTRIES ===
  entries: InflowEntry[];
}
```

---

## Testing Methodology: Test-First Development

### Test Structure

Each utility function should have corresponding tests in `__tests__/` directories:

```
inflow_periods/__tests__/
├── alignTransactionsToInflowPeriods.test.ts
├── predictNextPayment.test.ts
├── calculateAllOccurrencesInPeriod.test.ts
├── calculateInflowPeriodStatus.test.ts
└── fixtures/
    ├── mockInflows.ts
    ├── mockTransactions.ts
    └── mockSourcePeriods.ts
```

### Test Matrix Approach

For `calculateAllOccurrencesInPeriod`:

| Income Frequency | Period Type | Expected Occurrences | Status |
|------------------|-------------|---------------------|--------|
| WEEKLY | WEEKLY | 1 | |
| WEEKLY | MONTHLY | 4-5 | |
| BIWEEKLY | MONTHLY | 2-3 | |
| SEMI_MONTHLY | MONTHLY | 2 | |
| MONTHLY | MONTHLY (due) | 1 | |
| MONTHLY | MONTHLY (not due) | 0 | |
| MONTHLY | WEEKLY | 0 or 1 | |
| QUARTERLY | MONTHLY | 0 or 1 | |
| ANNUALLY | MONTHLY | 0 or 1 | |

For `predictNextPayment`:

| Income Type | Scenario | Expected Behavior |
|-------------|----------|-------------------|
| SALARY | Regular biweekly | Use Plaid prediction or frequency calc |
| HOURLY | Variable | Use rolling average or user override |
| COMMISSION | Monthly | Use commission config schedule |
| BONUS | Annual | Use bonus config expected month |

### Running Tests

```bash
# Run all inflow tests
npm test -- inflows

# Run specific test file
npm test -- alignTransactionsToInflowPeriods.test.ts

# Run with coverage
npm test -- --coverage inflows
```

---

## Development Guidelines

### Adding New Features

1. **Write tests first** in `__tests__/` directory
2. Implement the feature
3. Verify all tests pass
4. Update this documentation if adding new concepts

### Module Independence

- Each module should be self-contained
- Minimize cross-module imports
- Use clear interfaces between modules

### Error Handling

- Always wrap async operations in try/catch
- Log errors with context
- Don't throw in triggers (use console.error and return)

---

## Notes for AI Assistants

### Key Differences from Outflows

1. **Direction**: Inflows are positive money coming IN, outflows are money going OUT
2. **Plaid amounts**: Inflow amounts are NEGATIVE in Plaid (money in), we store as POSITIVE
3. **Terminology**: "paid" for inflows means "received", not "we paid"
4. **Variable income**: Inflows support variable income tracking (hourly, commission)

### When Working on Inflows

1. Always use positive amounts (Math.abs on Plaid amounts)
2. Remember that `isPaid` means income was RECEIVED
3. Check income type when calculating predictions
4. Support both Plaid and manual income entries

### Critical Paths

- Inflow creation: `inflow_main/triggers/onInflowCreated` → `inflow_periods/crud/createInflowPeriods` → `alignTransactionsToInflowPeriods`
- Income received: Update occurrence arrays → Recalculate totals → Update summary
- Variable income: Check `variableIncomeConfig` for prediction method
