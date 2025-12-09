# Outflows System - Cloud Functions

## ⚠️ RBAC System Migration (2025-01)

**IMPORTANT**: The Outflows System will be updated to support the new RBAC (Role-Based Access Control) and group-based sharing system.

### Upcoming Changes:
- **RecurringOutflow interface** will add ownership and sharing fields (`createdBy`, `ownerId`, `sharing`)
- **OutflowPeriod interface** will inherit sharing from parent outflow
- Legacy `familyId` field will remain for backward compatibility
- **Security rules** will validate resource-level permissions
- **Cloud Functions** will check permissions before operations

### Current Status:
- Phase 1 (Types) completed - Backend types updated in `/src/types/`
- Phase 2 (Resource Updates) in progress - Outflow interfaces need updating
- See `/RBAC_IMPLEMENTATION_STATUS.md` for detailed migration status

### For Detailed Architecture:
- See main `/CLAUDE.md` for RBAC system architecture
- Review `/src/types/sharing.ts` for sharing interfaces
- Check `/src/types/users.ts` for system role capabilities

---

## Overview

The Outflows System is a **recurring bill management module** that enables users to create, track, and monitor recurring expenses (bills) with automatic period-based withholding calculations. It supports both Plaid-synced recurring transactions and user-created bills, with automatic period generation and financial planning features.

### Core Concept: Three-Module Architecture

The Outflows System is organized into **three domain-specific modules**, each with clear responsibilities:

1. **`outflow_main`** - Recurring Bill Definitions
   - Manages Plaid-detected and user-created recurring expenses
   - Stores bill details (amount, frequency, merchant)
   - Handles Plaid stream synchronization
   - Triggers period generation

2. **`outflow_periods`** - Withholding Instances
   - Creates period-specific withholding allocations
   - Calculates daily withholding rates
   - Tracks payment status per period
   - Primary user interaction point for financial planning

3. **`outflow_summaries`** - Period-Centric Aggregations
   - Aggregates outflow periods by source period
   - Provides period-centric views for users
   - Powers summary tiles and dashboards
   - Maintains denormalized summary data

---

## Architecture

### Module Structure (Updated December 2025)

```
outflows/
├── index.ts                    # Main module exports
├── CLAUDE.md                   # This documentation
├── Restructure_Plan.md         # Migration history
│
├── outflow_main/               # MODULE 1: Recurring Bill Definitions
│   ├── __tests__/              # Unit tests for outflow_main
│   ├── admin/                  # Admin utilities
│   ├── api/                    # Public API endpoints
│   ├── crud/                   # Create/Read/Update/Delete operations
│   │   └── createManualOutflow.ts
│   ├── dev/                    # Development and testing functions
│   │   ├── createTestOutflows.ts
│   │   ├── debugOutflowPeriods.ts
│   │   ├── simulatePlaidRecurring.ts
│   │   └── testOutflowUpdate.ts
│   ├── triggers/               # Firestore triggers
│   │   ├── onOutflowCreated.ts
│   │   └── onOutflowUpdated.ts
│   ├── types/                  # Type definitions
│   │   └── index.ts
│   └── utils/                  # Outflow-specific utilities
│       ├── formatRecurringOutflows.ts
│       ├── enhanceRecurringOutflows.ts
│       ├── batchCreateRecurringStreams.ts
│       └── index.ts
│
├── outflow_periods/            # MODULE 2: Withholding Instances
│   ├── __tests__/              # Unit tests for outflow_periods
│   │   └── calculateOutflowPeriodStatus.test.ts
│   ├── admin/                  # Admin utilities
│   ├── api/                    # Public API endpoints
│   │   ├── assignSplitToAllOutflowPeriods.ts
│   │   ├── unassignSplitFromAllOutflowPeriods.ts
│   │   ├── getOutflowPeriodTransactions.ts
│   │   └── index.ts
│   ├── crud/                   # CRUD operations
│   │   ├── createOutflowPeriods.ts
│   │   └── index.ts
│   ├── dev/                    # Development functions
│   │   ├── extendOutflowPeriods.ts
│   │   ├── migrateTransactionSplits.ts
│   │   ├── debugTransactionMatching.ts
│   │   └── index.ts
│   ├── triggers/               # Firestore triggers
│   │   └── onOutflowPeriodCreate.ts
│   ├── types/                  # Type definitions
│   │   └── index.ts
│   └── utils/                  # Period-specific utilities
│       ├── calculatePeriodGenerationRange.ts
│       ├── getDaysInPeriod.ts
│       ├── batchCreateOutflowPeriods.ts
│       ├── checkIsDuePeriod.ts
│       ├── calculateWithholdingAmount.ts
│       ├── calculateOutflowPeriodStatus.ts
│       ├── calculateAllOccurrencesInPeriod.ts
│       ├── autoMatchTransactionToOutflowPeriods.ts
│       ├── autoMatchSinglePeriod.ts
│       ├── findMatchingOutflowPeriods.ts
│       ├── predictFutureBillDueDate.ts
│       ├── runUpdateOutflowPeriods.ts
│       ├── updateBillStatus.ts
│       └── index.ts
│
└── outflow_summaries/          # MODULE 3: Period-Centric Aggregations
    ├── __tests__/              # Unit tests for summaries
    ├── admin/                  # Admin utilities
    ├── api/                    # Public API endpoints
    ├── crud/                   # CRUD operations
    │   ├── updateOutflowPeriodSummary.ts
    │   ├── deleteOutflowPeriodSummary.ts
    │   └── index.ts
    ├── dev/                    # Development functions
    ├── triggers/               # Firestore triggers
    ├── types/                  # Type definitions
    └── utils/                  # Summary-specific utilities
        ├── periodTypeHelpers.ts
        ├── batchUpdateSummary.ts
        ├── recalculatePeriodGroup.ts
        ├── updatePeriodNames.ts
        └── index.ts
```

### Key Concepts

#### Outflows (`outflows` collection)
- **Recurring expense definition** (bill details, frequency, amount)
- Two sources: **Plaid-synced** (auto-detected) or **User-created** (manual)
- Define merchant, amount, frequency (weekly, monthly, etc.)
- Track payment cycles and due dates
- Managed by **`outflow_main`** module

#### Outflow Periods (`outflow_periods` collection)
- **Primary user interaction point** for financial planning
- Time-based withholding allocations for each period
- Calculate daily withholding rate based on bill frequency
- Track amount to set aside vs amount due in each period
- Support all period types: Monthly, Bi-Monthly, Weekly
- Automatically generated when outflow is created
- Managed by **`outflow_periods`** module

#### Outflow Summaries (`outflow_summary` collection)
- **Period-centric aggregation** of outflow periods
- Groups periods by source period ID (e.g., "2025-M01")
- Powers dashboard tiles and summary views
- Denormalized data for fast queries
- Managed by **`outflow_summaries`** module

#### Source Periods (`source_periods` collection)
- Single source of truth for all period definitions
- Pre-generated by admin functions
- Ensures consistency across budgets, outflows, and inflows
- Referenced by all three outflow modules

---

## Module 1: Outflow Main

### Purpose
Manages recurring bill definitions from both Plaid and user-created sources.

### Key Files

#### CRUD Operations
- **`crud/createManualOutflow.ts`** - Create user-defined recurring bills
  - Callable Cloud Function
  - Accepts bill details (name, amount, frequency, due day)
  - Creates `outflows` document
  - Triggers period generation via `onOutflowCreated`

#### Triggers
- **`triggers/onOutflowCreated.ts`** - Auto-generate periods when outflow is created
  - Firestore trigger on `outflows` collection create
  - Calls `createOutflowPeriodsFromSource()` to generate 3 months of periods
  - Handles both Plaid-synced and user-created outflows
  - Memory: 512MiB, Timeout: 60s

- **`triggers/onOutflowUpdated.ts`** - Cascade updates to periods
  - Firestore trigger on `outflows` collection update
  - Detects changes to `averageAmount`, `userCustomName`, `transactionIds`
  - Calls `runUpdateOutflowPeriods()` to sync changes
  - Only updates unpaid periods (preserves payment history)

#### Utilities
- **`utils/formatRecurringOutflows.ts`** - Format Plaid streams to internal structure
  - Step 1 of Plaid sync pipeline
  - Pure data mapping from Plaid API response
  - Flattens amount fields, normalizes dates

- **`utils/enhanceRecurringOutflows.ts`** - Add business logic and enrichments
  - Step 2 of Plaid sync pipeline
  - Adds expense type detection (subscription, utility, loan, etc.)
  - Determines if expense is essential
  - Future: merchant name standardization, category mapping

- **`utils/batchCreateRecurringStreams.ts`** - Upsert outflows to Firestore
  - Step 3 of Plaid sync pipeline
  - Smart upsert logic (create vs update)
  - Preserves user modifications
  - Updates transaction IDs array

#### Dev/Testing Functions
- **`dev/createTestOutflows.ts`** - Create sample outflows for testing
  - HTTP request function
  - Simulates Plaid recurring sync pipeline
  - Creates realistic test data (Internet, Netflix, Gym)

- **`dev/debugOutflowPeriods.ts`** - Debug outflow period calculations
  - HTTP request function
  - Returns diagnostic information
  - Shows payment cycles, withholding amounts

- **`dev/simulatePlaidRecurring.ts`** - Simulate Plaid recurring transaction sync
  - HTTP request function
  - Fetches mock Plaid recurring data
  - Runs full format → enhance → batch create pipeline

- **`dev/testOutflowUpdate.ts`** - Test outflow update trigger
  - HTTP request function
  - Simulates outflow updates
  - Validates period cascading

---

## Module 2: Outflow Periods

### Purpose
Manages period-specific withholding allocations and payment tracking.

### Key Files

#### CRUD Operations
- **`crud/createOutflowPeriods.ts`** - Generate outflow periods from source periods
  - Main period creation logic
  - Queries source_periods for date range
  - Calculates withholding amounts per period
  - Batch creates period documents
  - Called by `onOutflowCreated` trigger

#### API Functions
- **`api/assignSplitToAllOutflowPeriods.ts`** - Assign transaction split to bill payment
  - Callable Cloud Function
  - Assigns split to ALL THREE period types (monthly, weekly, bi-weekly)
  - Updates transaction split with period references
  - Adds `TransactionSplitReference` to periods
  - Recalculates payment status

- **`api/unassignSplitFromAllOutflowPeriods.ts`** - Remove split assignment
  - Callable Cloud Function
  - Clears split from all period types
  - Removes period references from split
  - Restores budget assignment if needed

- **`api/getOutflowPeriodTransactions.ts`** - Get transactions for a period
  - Callable Cloud Function
  - Read-only query
  - Returns all assigned transaction splits

#### Triggers
- **`triggers/onOutflowPeriodCreate.ts`** - Handle period creation events
  - Firestore trigger on `outflow_periods` collection create
  - Future: Update summary documents
  - Future: Send notifications for upcoming bills

#### Utilities (Period Creation)
- **`utils/calculatePeriodGenerationRange.ts`** - Calculate date range for period generation
  - Determines start/end dates for period creation
  - Default: 3 months forward from today
  - Handles edge cases (leap years, month boundaries)

- **`utils/getDaysInPeriod.ts`** - Calculate days in a period
  - Simple date math utility
  - Used for withholding calculations
  - Handles partial periods

- **`utils/batchCreateOutflowPeriods.ts`** - Batch write periods to Firestore
  - Efficient batch operations (500 docs per batch)
  - Constructs period documents
  - Handles Firestore batch limits

#### Utilities (Period Calculations)
- **`utils/checkIsDuePeriod.ts`** - Determine if bill is due in period
  - Compares due date to period date range
  - Returns boolean + due date
  - Critical for payment status

- **`utils/calculateWithholdingAmount.ts`** - Calculate amount to withhold
  - Formula: `dailyRate × daysInPeriod`
  - Daily rate: `billAmount / cycleDays`
  - Rounds to 2 decimal places

- **`utils/calculateOutflowPeriodStatus.ts`** - Determine period payment status
  - Returns: `pending`, `partial`, `paid`, `overdue`, `not_due`
  - Compares payments to amount due
  - Checks due dates for overdue detection

- **`utils/calculateAllOccurrencesInPeriod.ts`** - Calculate bill occurrences
  - For bills that occur multiple times per period
  - Used in withholding calculations
  - Handles edge cases (weekly bills in monthly periods)

#### Utilities (Transaction Matching)
- **`utils/autoMatchTransactionToOutflowPeriods.ts`** - Auto-match transactions to periods
  - Matches historical Plaid transactions to outflow periods
  - Called after outflow creation
  - Determines payment type (regular, catch_up, advance)

- **`utils/autoMatchSinglePeriod.ts`** - Match transactions to single period
  - Helper for auto-matching
  - Finds matching period based on date
  - Assigns transaction split to period

- **`utils/findMatchingOutflowPeriods.ts`** - Find periods by date or source period
  - Queries for matching monthly, weekly, bi-weekly periods
  - Two modes: by transaction date OR by target source period
  - Returns all three period types

#### Utilities (Period Updates)
- **`utils/predictFutureBillDueDate.ts`** - Calculate next bill due date
  - Projects forward from last date using frequency
  - Adjusts for weekends (Saturday/Sunday → Monday)
  - Used in period calculations

- **`utils/runUpdateOutflowPeriods.ts`** - Cascade outflow changes to periods
  - Called by `onOutflowUpdated` trigger
  - Updates unpaid periods only (preserves payment history)
  - Handles amount changes, name changes, transaction ID changes
  - Batch operations for efficiency

- **`utils/updateBillStatus.ts`** - Update bill status
  - Placeholder/deprecated utility
  - Future: More sophisticated status logic

#### Dev/Testing Functions
- **`dev/extendOutflowPeriods.ts`** - Generate additional periods forward in time
  - HTTP request function
  - Extends periods beyond 3-month default
  - Useful for testing long-term scenarios

- **`dev/migrateTransactionSplits.ts`** - Add transactionSplits field to periods
  - HTTP request function
  - Data migration utility
  - Adds empty transactionSplits array to existing periods

- **`dev/debugTransactionMatching.ts`** - Debug transaction matching logic
  - HTTP request function
  - Shows matched/unmatched transactions
  - Validates auto-matching results

---

## Module 3: Outflow Summaries

### Purpose
Provides period-centric aggregation views for dashboard tiles and summary displays.

### Key Concepts

The summary system aggregates outflow periods by source period, creating denormalized summary documents that power fast queries for user dashboards.

**Example Summary Structure:**
```typescript
{
  id: "user123_outflowsummary_monthly",
  ownerId: "user123",
  ownerType: "user",
  periodType: "MONTHLY",
  resourceType: "outflow",
  periods: {
    "2025-M01": [
      {
        periodId: "period_123",
        outflowId: "outflow_456",
        merchant: "Comcast",
        userCustomName: "Internet",
        totalAmountDue: 89.99,
        totalAmountPaid: 0,
        isDuePeriod: true,
        // ... more fields
      }
    ],
    "2025-M02": [ /* February periods */ ]
  }
}
```

### Key Files

#### CRUD Operations
- **`crud/updateOutflowPeriodSummary.ts`** - Update summary when period changes
  - Called by centralized summary triggers
  - Recalculates affected period group
  - Updates both user and group summaries

- **`crud/deleteOutflowPeriodSummary.ts`** - Update summary when period deleted
  - Called by centralized summary triggers
  - Removes period from summary
  - Recalculates totals

#### Utilities
- **`utils/periodTypeHelpers.ts`** - Determine period type from source period ID
  - Parses source period ID format
  - Returns MONTHLY, WEEKLY, or BI_MONTHLY
  - Example: "2025-M01" → MONTHLY, "2025-W01" → WEEKLY

- **`utils/batchUpdateSummary.ts`** - Core orchestration for summary updates
  - Coordinates multiple update operations
  - Atomic Firestore writes
  - Supports two operation types:
    - `recalculate`: Recalculate period group from scratch
    - `updateNames`: Update merchant/userCustomName fields
  - Exports `getSummaryId()` helper for document ID generation

- **`utils/recalculatePeriodGroup.ts`** - Recalculate all entries for a source period
  - Queries all outflow_periods with given sourcePeriodId
  - Creates ONE OutflowPeriodEntry per period (no aggregation)
  - Fetches parent outflow data
  - Returns array ready for batch write

- **`utils/updatePeriodNames.ts`** - Update denormalized names across entries
  - Updates merchant/userCustomName when parent outflow changes
  - Pure function (no Firestore calls)
  - Returns updated periods object

---

## Data Models

### Outflow Document (Recurring Bill Definition)

**Collection:** `outflows`
**Managed by:** `outflow_main` module

```typescript
interface RecurringOutflow {
  id: string;

  // Core identification
  streamId: string;                // Plaid stream ID or user-generated ID
  itemId: string;                  // Plaid item ID or 'manual'
  userId: string;                  // Owner user ID
  familyId: string | null;         // Family association (null for personal)
  accountId: string;               // Plaid account ID or 'manual'

  // Stream classification
  isActive: boolean;               // Whether outflow is active
  status: PlaidRecurringTransactionStatus; // MATURE, EARLY_DETECTION, etc.

  // Transaction details
  description: string;             // Bill name/description
  merchantName: string | null;     // Merchant/company name
  category: string[];              // Plaid category hierarchy
  personalFinanceCategory: PlaidPersonalFinanceCategory | null;

  // Amount information (FLAT STRUCTURE - 2025-01-03)
  // ⚠️ CRITICAL: Use flat numbers, NOT nested objects!
  averageAmount: number;           // Direct number (e.g., 89.99)
  lastAmount: number;              // Direct number (e.g., 89.99)
  currency: string;                // Currency code (e.g., "USD")
  unofficialCurrency: string | null;

  // Frequency and timing
  frequency: PlaidRecurringFrequency; // WEEKLY, MONTHLY, etc.

  // Historical data
  firstDate: Timestamp;            // First occurrence
  lastDate: Timestamp;             // Last/expected occurrence
  transactionIds: string[];        // Linked Plaid transaction IDs

  // Family Finance specific fields
  userCategory: string | null;     // User-assigned category override
  userNotes: string | null;        // User notes
  tags: string[];                  // User tags
  isHidden: boolean;               // Hide from main views

  // Outflow-specific fields
  expenseType: OutflowExpenseType; // subscription, utility, loan, etc.
  isEssential: boolean;            // Whether expense is essential
  merchantCategory: string | null; // Merchant category
  isCancellable: boolean;          // Can this bill be cancelled?
  reminderDays: number;            // Days before due to send reminder

  // User-created outflow metadata
  isUserCreated?: boolean;         // Flag for user-created vs Plaid
  outflowSource?: 'plaid' | 'user'; // Source of this outflow
  dueDay?: number | null;          // Day of month when due (monthly bills)
  nextDueDate?: Timestamp;         // Next due date

  // Sync metadata
  lastSyncedAt: Timestamp;         // Last Plaid sync
  syncVersion: number;             // Sync version number

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### Outflow Period Document (Withholding Instance)

**Collection:** `outflow_periods`
**Managed by:** `outflow_periods` module

```typescript
interface OutflowPeriod {
  id: string;                      // Format: "{outflowId}_{sourcePeriodId}"
  outflowId: string;               // Reference to parent outflow
  sourcePeriodId: string;          // Reference to source_periods (e.g., "2025-W01")
  userId: string;                  // Outflow owner
  ownerId: string;                 // Same as userId (new RBAC field)
  groupId: string | null;          // Group association (RBAC)

  // Period context (denormalized for performance)
  periodType: PeriodType;          // WEEKLY, BI_MONTHLY, MONTHLY
  periodStartDate: Timestamp;      // Period start
  periodEndDate: Timestamp;        // Period end

  // Payment cycle information
  cycleStartDate: Timestamp;       // Bill payment cycle start
  cycleEndDate: Timestamp;         // Bill payment cycle end (due date)
  cycleDays: number;               // Days in payment cycle

  // Financial calculations
  averageAmount: number;           // Bill average amount
  expectedAmount: number;          // Expected bill amount
  totalAmountDue: number;          // Total amount due in this period
  totalAmountPaid: number;         // Total amount paid
  totalAmountUnpaid: number;       // Remaining unpaid
  amountWithheld: number;          // Amount to withhold in THIS period
  dailyWithholdingRate: number;    // Amount to withhold per day

  // Occurrence tracking
  occurrencesInPeriod: number;     // Number of bill occurrences
  amountPerOccurrence: number;     // Amount per occurrence

  // Payment status
  isDuePeriod: boolean;            // Is bill due during this period?
  dueDate?: Timestamp;             // Actual due date (if isDuePeriod)
  expectedDueDate?: Timestamp;     // Expected due date from prediction
  status: OutflowPeriodStatus;     // pending, partial, paid, overdue, not_due
  isFullyPaid: boolean;            // Whether fully paid
  isPartiallyPaid: boolean;        // Whether partially paid
  isPaid: boolean;                 // Legacy field (use isFullyPaid)
  isActive: boolean;               // Whether period is active

  // Transaction assignments
  transactionSplits: TransactionSplitReference[]; // Assigned payments

  // Metadata from outflow (denormalized for performance)
  description: string;             // Bill name
  userCustomName?: string;         // User's custom name for bill
  merchantName: string | null;     // Merchant name
  expenseType: OutflowExpenseType; // Expense type
  isEssential: boolean;            // Is essential expense

  // System fields
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastCalculated: Timestamp;       // Last calculation timestamp
}
```

### Outflow Period Summary Document

**Collection:** `outflow_summary`
**Managed by:** `outflow_summaries` module

```typescript
interface OutflowPeriodSummary {
  id: string;                      // Format: "{ownerId}_outflowsummary_{periodType}"
  ownerId: string;                 // User or group ID
  ownerType: 'user' | 'group';     // Owner type
  periodType: PeriodType;          // MONTHLY, WEEKLY, BI_MONTHLY
  resourceType: 'outflow';         // Always 'outflow'

  // Summary data grouped by source period
  periods: {
    [sourcePeriodId: string]: OutflowPeriodEntry[];
  };

  // Metadata
  totalItemCount: number;          // Total entries across all periods
  windowStart: Timestamp;          // Summary time window start
  windowEnd: Timestamp;            // Summary time window end
  lastRecalculated: Timestamp;     // Last full recalculation
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface OutflowPeriodEntry {
  // Period Identity
  periodId: string;                // Outflow period ID
  outflowId: string;               // Parent outflow ID
  groupId: string;                 // Group ID (RBAC)
  merchant: string;                // Merchant name
  userCustomName: string;          // User's custom name

  // Amount Totals
  totalAmountDue: number;          // Total due
  totalAmountPaid: number;         // Total paid
  totalAmountUnpaid: number;       // Total unpaid
  totalAmountWithheld: number;     // Total withheld
  averageAmount: number;           // Average amount

  // Due Status
  isDuePeriod: boolean;            // Is due in this period
  duePeriodCount: number;          // Count of due periods (0 or 1)

  // Status Breakdown
  statusCounts: OutflowStatusCounts; // Count by status

  // Progress Metrics
  paymentProgressPercentage: number; // 0-100
  fullyPaidCount: number;          // Count fully paid
  unpaidCount: number;             // Count unpaid
  itemCount: number;               // Always 1 (one entry per period)
}
```

---

## Common Workflows

### Creating a User-Defined Bill

**Module:** `outflow_main`

1. **User creates recurring bill** via `createManualOutflow` function
   ```typescript
   import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

   const functions = getFunctions();
   const createOutflow = httpsCallable(functions, 'createManualOutflow');

   const result = await createOutflow({
     description: "Netflix Subscription",
     merchantName: "Netflix",
     amount: 15.99,
     frequency: "monthly",
     expenseType: "subscription",
     isEssential: false,
     dueDay: 15
   });
   ```

2. **`onOutflowCreated` trigger fires** automatically
   - Location: `outflow_main/triggers/onOutflowCreated.ts`
   - Calculates payment cycle and daily withholding rate
   - Calls `createOutflowPeriodsFromSource()`

3. **Outflow period instances generated** from source_periods
   - Location: `outflow_periods/crud/createOutflowPeriods.ts`
   - 3 months of monthly, bi-monthly, and weekly instances created
   - Batch written to `outflow_periods` collection

4. **User can now view** withholding amounts in their budget
   - See how much to set aside each week/month
   - Track upcoming bill due dates

### Plaid-Detected Recurring Transaction

**Module:** `outflow_main`

1. **Plaid detects recurring pattern** in user transactions
2. **Plaid webhook** notifies system
3. **Recurring outflow created** via `formatRecurringOutflows` → `enhanceRecurringOutflows` → `batchCreateRecurringStreams`
4. **`onOutflowCreated` trigger fires** automatically
5. **Outflow_periods generated** for planning
6. **User sees new bill** in their outflows list

### Assigning a Payment to a Bill

**Module:** `outflow_periods`

1. **User marks transaction as bill payment:**
   - Opens transaction detail screen
   - Selects "Assign to Bill"
   - Chooses outflow from list

2. **System assigns to all period types:**
   ```typescript
   const assignSplit = httpsCallable(functions, 'assignSplitToAllOutflowPeriods');

   await assignSplit({
     transactionId: "txn_123",
     splitId: "split_456",
     outflowId: "outflow_789",
     paymentType: "regular",
     clearBudgetAssignment: true
   });
   ```

3. **Function finds matching periods:**
   - Location: `outflow_periods/api/assignSplitToAllOutflowPeriods.ts`
   - Uses `findMatchingOutflowPeriods()` to find monthly, weekly, bi-weekly periods
   - Updates transaction split with all three period references
   - Adds `TransactionSplitReference` to each period

4. **Period status recalculated:**
   - Location: `outflow_periods/utils/calculateOutflowPeriodStatus.ts`
   - Compares payments to amount due
   - Updates status (pending → paid)

5. **User sees updated status:**
   - Monthly view: "Internet Bill - Paid"
   - Weekly view: "Internet Bill - Paid"
   - All views stay in sync

### Updating an Outflow

**Module:** `outflow_main` + `outflow_periods`

1. **User updates outflow** (e.g., changes custom name)
2. **`onOutflowUpdated` trigger fires:**
   - Location: `outflow_main/triggers/onOutflowUpdated.ts`
   - Detects changed fields (averageAmount, userCustomName, transactionIds)

3. **Periods updated automatically:**
   - Location: `outflow_periods/utils/runUpdateOutflowPeriods.ts`
   - Queries all unpaid periods for this outflow
   - Updates amounts, names, or transaction assignments
   - Batch writes changes

4. **User sees updated data** in all views

---

## Payment Tracking System

### Transaction Split Assignment

The system supports assigning transaction splits to outflow periods for payment tracking. This enables users to link bank transactions to their recurring bills.

**Key Feature:** **Multi-Period Assignment**
- One transaction split can be assigned to ALL THREE period types simultaneously
- Ensures consistency across monthly, weekly, and bi-weekly views
- Bi-directional references (split ↔ period)

### TransactionSplit Interface

```typescript
interface TransactionSplit {
  id: string;

  // Budget assignment
  budgetId: string;
  budgetName: string;

  // Outflow assignment (all three period types)
  outflowId?: string;                    // Parent outflow ID
  outflowDescription?: string;           // Denormalized description
  outflowPeriodId?: string;              // Primary period reference
  outflowMonthlyPeriodId?: string;       // Monthly period ID
  outflowWeeklyPeriodId?: string;        // Weekly period ID
  outflowBiWeeklyPeriodId?: string;      // Bi-weekly period ID

  // Payment tracking
  paymentType?: PaymentType;             // regular, catch_up, advance, extra_principal
  paymentDate?: Timestamp;               // Date payment was made

  // Other fields
  amount: number;
  categoryId: string;
  description?: string;
  isDefault: boolean;
}
```

### TransactionSplitReference Interface

Stored in outflow_periods to track assigned payments:

```typescript
interface TransactionSplitReference {
  transactionId: string;           // Reference to transactions document
  splitId: string;                 // Specific split within transaction
  transactionDate: Timestamp;      // When transaction occurred
  amount: number;                  // Split amount
  description: string;             // Transaction description
  paymentType: PaymentType;        // Payment classification
  isAutoMatched: boolean;          // Was this auto-matched or manual?
  matchedAt: Timestamp;            // When assignment occurred
  matchedBy: string;               // User ID or 'system'
}
```

### Payment Types

```typescript
enum PaymentType {
  REGULAR = 'regular',              // Normal on-time payment
  CATCH_UP = 'catch_up',            // Payment for past-due bill
  ADVANCE = 'advance',              // Payment made well before due date
  EXTRA_PRINCIPAL = 'extra_principal' // Extra payment beyond required amount
}
```

### Auto-Matching

When an outflow is created (Plaid-detected), the system automatically matches historical transactions:

**Process:**
1. `onOutflowCreated` trigger fires
2. After creating periods, calls `autoMatchTransactionToOutflowPeriods()`
3. Fetches all transactions in `outflow.transactionIds` array
4. For each transaction:
   - Finds matching outflow period based on date
   - Determines payment type (regular, catch_up, advance)
   - Assigns split to appropriate period
   - Sets `paymentDate` to match transaction date
5. Recalculates all period statuses

**Location:** `outflow_periods/utils/autoMatchTransactionToOutflowPeriods.ts`

---

## Summary System

### Overview

The summary system provides fast, aggregated views of outflow periods grouped by source period. This powers dashboard tiles and summary displays without expensive real-time aggregations.

### How It Works

1. **Outflow period created/updated/deleted**
2. **Centralized trigger fires** (future: in `summaries/` module)
3. **Calls appropriate CRUD function:**
   - `updateOutflowPeriodSummary()` for creates/updates
   - `deleteOutflowPeriodSummary()` for deletes
4. **CRUD function calls `batchUpdateSummary()`:**
   - Fetches current summary document
   - Executes recalculate operation for affected source period
   - Writes updated summary back to Firestore
5. **Frontend queries summary collection:**
   - Fast reads (no aggregation needed)
   - Denormalized data ready for display

### Summary Document Structure

```typescript
{
  id: "user123_outflowsummary_monthly",
  ownerId: "user123",
  ownerType: "user",
  periodType: "MONTHLY",
  periods: {
    "2025-M01": [
      { periodId: "...", merchant: "Comcast", totalAmountDue: 89.99, ... },
      { periodId: "...", merchant: "Netflix", totalAmountDue: 15.99, ... }
    ],
    "2025-M02": [ ... ]
  },
  totalItemCount: 24,
  lastRecalculated: Timestamp
}
```

**Key Points:**
- **One entry per outflow period** (no aggregation by merchant)
- Groups entries by source period ID
- Supports both user and group summaries
- Separate documents for each period type (monthly, weekly, bi-monthly)

### Querying Summaries

```typescript
// Frontend query for monthly summary
const summaryRef = doc(db, 'outflow_summary', `${userId}_outflowsummary_monthly`);
const summarySnap = await getDoc(summaryRef);

if (summarySnap.exists()) {
  const summary = summarySnap.data();
  const january2025 = summary.periods['2025-M01'];
  // Display january2025 entries in dashboard
}
```

---

## Development Guidelines

### Adding New Features

#### When to add to `outflow_main`:
- Managing outflow definitions (create, update, delete)
- Plaid stream synchronization
- Outflow-level business logic
- Triggers that affect outflow documents

#### When to add to `outflow_periods`:
- Period generation and calculations
- Withholding logic
- Payment tracking and status
- Transaction split assignments
- Period-level queries and operations

#### When to add to `outflow_summaries`:
- Aggregation logic
- Summary document updates
- Dashboard data preparation
- Period-centric views

### File Organization

**CRUD Operations:**
- Place in `{module}/crud/` directory
- Export from `{module}/crud/index.ts`
- Re-export from main `outflows/index.ts` if public API

**Utilities:**
- Place in `{module}/utils/` directory
- Export from `{module}/utils/index.ts`
- Keep utilities module-specific (avoid cross-module dependencies)

**Triggers:**
- Place in `{module}/triggers/` directory
- Export from main `outflows/index.ts`
- Follow naming convention: `on{Resource}{Action}`

**Dev/Testing:**
- Place in `{module}/dev/` directory
- HTTP request functions for emulator testing
- Export from `{module}/dev/index.ts`

**Tests:**
- Place in `{module}/__tests__/` directory
- Name files: `{functionality}.test.ts`
- Co-locate tests with the code they test

### Best Practices

1. **Module Independence:**
   - Each module should be self-contained
   - Minimize cross-module imports
   - Use clear interfaces between modules

2. **Utility Functions:**
   - Keep utilities pure and testable
   - Document inputs, outputs, and side effects
   - Use TypeScript strictly (no `any` types)

3. **Triggers:**
   - Keep trigger functions lightweight
   - Delegate heavy work to utility functions
   - Handle errors gracefully (don't break parent operations)

4. **Batch Operations:**
   - Use Firestore batch writes for efficiency
   - Respect 500 document limit per batch
   - Log batch operations for debugging

5. **Denormalization:**
   - Denormalize data for performance
   - Keep denormalized data in sync via triggers
   - Document which fields are denormalized

6. **Error Handling:**
   - Always wrap async operations in try/catch
   - Log errors with context
   - Return meaningful error messages to clients

### Testing Methodology: Test-First Verification

**IMPORTANT:** When making changes to critical logic (calculations, algorithms, data transformations), always use **Test-First Verification** before implementation:

#### Approach:

1. **Write Comprehensive Unit Tests First**
   - Create test file in `{module}/__tests__/` directory
   - Cover all scenarios using a test matrix approach
   - Include edge cases and boundary conditions
   - Test all combinations of inputs (frequencies, period types, etc.)

2. **Run Tests to Verify Current Behavior**
   ```bash
   npm test -- {testFileName}.test.ts
   ```

3. **Present Results in Table Format**
   - Create a clear matrix showing expected vs actual results
   - Identify any discrepancies between expected and actual behavior
   - Verify if issues are in code or test expectations

4. **Fix Issues Before Implementation**
   - If tests reveal bugs, fix the underlying logic
   - If tests have wrong expectations, update the tests
   - Ensure 100% test pass rate before proceeding

#### Example Test Matrix:

| Input Frequency | Period Type | Expected | Actual | Status |
|----------------|-------------|----------|--------|--------|
| WEEKLY | WEEKLY | 1 | ✓ 1 | ✅ PASS |
| WEEKLY | MONTHLY | 4-5 | ✓ 5 | ✅ PASS |
| BIWEEKLY | MONTHLY | 2-3 | ✓ 3 | ✅ PASS |

#### Benefits:

- ✅ **Verify foundation before building** - Ensure base logic works correctly
- ✅ **Catch regressions early** - Tests prevent breaking existing functionality
- ✅ **Document expected behavior** - Tests serve as living documentation
- ✅ **Enable confident refactoring** - Change code knowing tests will catch issues
- ✅ **Clear communication** - Table format shows what works and what doesn't

#### When to Use:

- Before implementing new features that depend on existing logic
- When refactoring critical calculation functions
- When debugging complex algorithms
- When validating edge cases and boundary conditions
- Before starting multi-phase implementation plans

**Example:** Phase 0 of the occurrence tracking implementation verified `calculateAllOccurrencesInPeriod()` with 18 comprehensive tests covering all frequency/period combinations before proceeding to Phase 1 (matching logic).

---

## Performance Considerations

### Indexing

**Required Composite Indexes:**

```json
{
  "indexes": [
    {
      "collectionGroup": "outflows",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
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
        { "fieldPath": "outflowId", "order": "ASCENDING" },
        { "fieldPath": "sourcePeriodId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "outflow_periods",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "isDuePeriod", "order": "ASCENDING" },
        { "fieldPath": "dueDate", "order": "ASCENDING" }
      ]
    }
  ]
}
```

### Query Optimization

**Frontend Loading Strategy:**
- **Summaries:** Query summary documents for dashboard displays
- **Details:** Query individual periods for detail views
- **Real-time:** Use Firestore listeners for live updates
- **Pagination:** Limit queries to current + 1 future period

**Backend Batch Operations:**
- Use batch writes for period generation (500 docs/batch)
- Use transactions for atomic updates
- Batch read operations when possible

### Denormalization Strategy

**Denormalized Fields in Periods:**
- `description`, `userCustomName`, `merchantName` from outflow
- `expenseType`, `isEssential` from outflow
- Kept in sync via `onOutflowUpdated` trigger

**Benefits:**
- Fast queries (no joins needed)
- Period documents are self-contained
- Frontend can display periods without fetching outflows

**Trade-offs:**
- Storage cost (duplicated data)
- Sync complexity (must update periods when outflow changes)
- Eventual consistency (brief delay between outflow update and period sync)

---

## Testing

### Unit Tests

**Test Files:**
- `outflow_periods/__tests__/calculateOutflowPeriodStatus.test.ts`

**Coverage:**
- Status calculation logic (pending, partial, paid, overdue, not_due)
- Edge cases (no payments, overpayment, exact payment)
- Date comparisons (past due, future due)

**Future Tests:**
- Withholding calculations
- Period generation
- Auto-matching logic
- Summary aggregations

### Dev Testing Functions

**`createTestOutflows`:**
- Simulates Plaid recurring sync
- Creates realistic test data
- Useful for frontend development

**`debugOutflowPeriods`:**
- Returns diagnostic information
- Shows calculation details
- Useful for troubleshooting

**`extendOutflowPeriods`:**
- Generates additional future periods
- Tests long-term scenarios
- Useful for year-end testing

### Emulator Testing

```bash
# Start emulators
firebase emulators:start

# Test outflow creation
curl -X POST http://localhost:5001/{project}/us-central1/createManualOutflow \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Test Bill",
    "amount": 100,
    "frequency": "monthly"
  }'

# Test period generation
curl http://localhost:5001/{project}/us-central1/debugOutflowPeriods?userId=testUser

# Test Plaid sync simulation
curl http://localhost:5001/{project}/us-central1/simulatePlaidRecurring?userId=testUser
```

---

## Migration Notes

### Restructure (December 2025)

The outflows module was restructured from a flat utility-based organization to a three-module domain-based architecture:

**Before:**
```
outflows/
├── api/
├── orchestration/
├── utils/
└── admin/
```

**After:**
```
outflows/
├── outflow_main/       # Recurring bill definitions
├── outflow_periods/    # Withholding instances
└── outflow_summaries/  # Period-centric aggregations
```

**Migration Actions:**
1. ✅ Moved all utilities to module-specific locations
2. ✅ Renamed `outflowPeriods.ts` → `createOutflowPeriods.ts`
3. ✅ Extracted helper functions to `outflow_periods/utils/`
4. ✅ Moved summary operations to `outflow_summaries/utils/`
5. ✅ Created `__tests__/` directories in all modules
6. ✅ Removed empty `/utils/`, `/orchestration/`, `/types/`, `/config/`, `/dev/` directories
7. ✅ Updated all import paths
8. ✅ Updated index files for clean exports

**See:** `Restructure_Plan.md` for detailed migration history

---

## Future Enhancements

### Planned Features

**Payment Tracking:**
- Mark bills as paid in outflow_periods
- Track payment history
- Auto-detect payments from linked accounts
- Payment reminders and notifications

**Smart Recommendations:**
- Suggest optimal withholding strategy
- Alert when bills are increasing
- Identify cancellable subscriptions
- Budget optimization suggestions

**Group Collaboration:**
- Shared household bills
- Split bill responsibilities
- Group bill dashboard
- Payment tracking across group members

**Advanced Analytics:**
- Bill spending trends over time
- Category breakdown of recurring expenses
- Essential vs non-essential analysis
- Year-over-year comparisons

**Summary Enhancements:**
- Real-time summary updates via triggers
- Configurable aggregation levels (by merchant, by category)
- Historical summaries (archive old periods)
- Performance monitoring and optimization

---

## Notes for AI Assistants

### Module Organization
- **outflow_main** = Recurring bill definitions (Plaid + user-created)
- **outflow_periods** = Withholding instances (period calculations)
- **outflow_summaries** = Period-centric aggregations (dashboard views)

### Key Principles
- ✅ Each module is self-contained with its own utilities, types, tests
- ✅ No shared `/utils/` directory - utilities belong to specific modules
- ✅ Triggers live in the module that owns the collection they watch
- ✅ Public APIs exported from module-specific locations
- ✅ Dev/testing functions in `{module}/dev/` directories

### When Adding New Code
1. **Determine which module** the code belongs to
2. **Choose appropriate subdirectory** (crud, api, utils, triggers, dev)
3. **Follow existing file naming conventions**
4. **Update module's index.ts** to export new functionality
5. **Add tests** in module's `__tests__/` directory
6. **Update this documentation** if adding new concepts

### Critical Paths
- Outflow creation: `outflow_main/crud/` → `outflow_main/triggers/onOutflowCreated` → `outflow_periods/crud/createOutflowPeriods`
- Period updates: `outflow_main/triggers/onOutflowUpdated` → `outflow_periods/utils/runUpdateOutflowPeriods`
- Payment assignment: `outflow_periods/api/assignSplitToAllOutflowPeriods` → `outflow_periods/utils/findMatchingOutflowPeriods`
- Summary updates: `outflow_summaries/crud/updateOutflowPeriodSummary` → `outflow_summaries/utils/batchUpdateSummary` → `outflow_summaries/utils/recalculatePeriodGroup`

### Common Pitfalls
- ❌ Don't create shared utilities in `/utils/` - use module-specific utils
- ❌ Don't import across modules excessively - keep modules independent
- ❌ Don't forget to update index files when adding new functions
- ❌ Don't skip tests - especially for calculation logic
- ❌ Don't use `any` types - TypeScript strict mode is enforced

### Reference Documents
- Main architecture: `/CLAUDE.md`
- RBAC implementation: `/RBAC_IMPLEMENTATION_STATUS.md`
- Restructure history: `/Restructure_Plan.md`
- Type definitions: `/src/types/index.ts`
