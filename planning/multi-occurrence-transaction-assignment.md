# Multi-Occurrence Transaction Assignment System

**Status:** Planning
**Created:** 2025-11-28
**Purpose:** Automatically assign and track multiple transaction occurrences to outflow periods when bill frequency differs from period type (e.g., weekly bills in monthly periods)

---

## Executive Summary

### The Problem

Currently, the system handles one-to-one matching between transactions and outflow periods. When an outflow has a higher frequency than the period (e.g., weekly bills in a monthly period), the system cannot:

1. Track that 4 weekly payments are expected in a monthly period
2. Automatically assign multiple transactions to a single outflow period
3. Determine if all expected occurrences have been paid
4. Update the summary document with multi-occurrence payment status

### The Solution

Implement a multi-occurrence tracking system that:

- Calculates expected occurrences based on frequency mismatch
- Maintains parallel arrays for occurrence tracking (paid status, transaction IDs, due dates)
- Auto-assigns transactions to correct occurrences based on date proximity
- Updates summaries with granular occurrence-level payment data
- Provides clear visual feedback for partial payment scenarios

### Key User Benefits

- **Clear Payment Tracking:** See 2/4 weekly bills paid this month
- **Automatic Matching:** Transactions automatically assigned to correct occurrence
- **Progress Visibility:** Visual indicators for partial payment status
- **Accurate Forecasting:** Better cash flow predictions with occurrence-level data

---

## User Experience Flows

### Flow 1: Weekly Bill in Monthly Period

**Scenario:** User has Netflix ($15.99/week) subscription, viewing November 2025 monthly period

**Current Behavior:**
- Outflow period shows single due amount of $63.96 (4 × $15.99)
- Can only mark entire period as paid/unpaid
- No visibility into which specific weeks were paid

**New Behavior:**
```
Netflix Subscription
├─ November 2025 Period
│  ├─ Week 1 (Nov 1-7)   ✓ PAID  [$15.99] [txn_abc123]
│  ├─ Week 2 (Nov 8-14)  ✓ PAID  [$15.99] [txn_def456]
│  ├─ Week 3 (Nov 15-21) ⏳ DUE   [$15.99] [---]
│  └─ Week 4 (Nov 22-28) ⏳ DUE   [$15.99] [---]
│
├─ Status: PARTIAL (2/4 paid)
├─ Progress: 50% ($31.98 / $63.96)
└─ Next Due: Nov 15, 2025
```

**User Actions:**
1. View monthly period summary
2. See 2/4 occurrences paid automatically (system matched transactions)
3. Receive alert: "2 Netflix payments due this month"
4. When new transaction arrives, system auto-assigns to Week 3
5. Summary updates in real-time

### Flow 2: Bi-Weekly Paycheck in Monthly Period

**Scenario:** User receives salary every 2 weeks, viewing monthly inflow period

**Current Behavior:**
- Shows single expected amount
- Binary paid/unpaid status
- No tracking of individual paychecks

**New Behavior:**
```
Employer Salary
├─ November 2025 Period
│  ├─ Pay Period 1 (Nov 1-14)  ✓ RECEIVED [$2,500] [txn_xyz789]
│  └─ Pay Period 2 (Nov 15-28) ✓ RECEIVED [$2,500] [txn_lmn012]
│
├─ Status: FULLY_RECEIVED (2/2 received)
├─ Progress: 100% ($5,000 / $5,000)
└─ Next Expected: Dec 1, 2025
```

### Flow 3: Transaction Auto-Assignment

**Scenario:** New transaction arrives from bank sync

**Process:**
1. **Transaction Created:** Netflix charge $15.99 on Nov 15, 2025
2. **Matching Triggered:** System detects transaction matches Netflix outflow
3. **Period Lookup:** Finds November monthly outflow_period
4. **Occurrence Calculation:** Determines this is Week 3 occurrence (Nov 15-21)
5. **Auto-Assignment:** Assigns transaction to occurrence index 2
6. **Status Update:** Updates occurrence arrays:
   ```typescript
   occurrences: {
     expectedCount: 4,
     paidStatus: [true, true, true, false],  // Week 3 now paid
     transactionIds: ['txn_abc', 'txn_def', 'txn_ghi', null],
     dueDates: [Nov 7, Nov 14, Nov 21, Nov 28]
   }
   ```
7. **Summary Refresh:** Triggers updateUserPeriodSummary
8. **Frontend Update:** Real-time listener updates UI

---

## Technical Architecture

### Phase 1: Data Model Enhancement

#### 1.1 OutflowPeriod Document Schema

**New Fields:**
```typescript
interface OutflowPeriod {
  // ... existing fields ...

  // === MULTI-OCCURRENCE TRACKING ===
  occurrences: {
    expectedCount: number;              // How many occurrences expected this period
    paidStatus: boolean[];              // Parallel array: [true, false, true, false]
    transactionIds: (string | null)[];  // Parallel array: ['txn_123', null, 'txn_789', null]
    dueDates: Timestamp[];              // Parallel array: [Nov 7, Nov 14, Nov 21, Nov 28]
    amounts: number[];                  // Parallel array: [15.99, 15.99, 15.99, 15.99]
  };

  // === COMPUTED FROM OCCURRENCES ===
  numberOfOccurrencesInPeriod: number;  // Length of arrays (4)
  numberOfOccurrencesPaid: number;      // Count of true in paidStatus (2)
  numberOfOccurrencesUnpaid: number;    // Count of false in paidStatus (2)
  paymentProgressPercentage: number;    // (2/4) * 100 = 50%
}
```

#### 1.2 InflowPeriod Document Schema

**New Fields:**
```typescript
interface InflowPeriod {
  // ... existing fields ...

  // === MULTI-OCCURRENCE TRACKING ===
  occurrences: {
    expectedCount: number;
    receivedStatus: boolean[];          // Same pattern as outflows
    transactionIds: (string | null)[];
    expectedDates: Timestamp[];
    amounts: number[];
  };

  // === COMPUTED FROM OCCURRENCES ===
  numberOfOccurrencesInPeriod: number;
  numberOfOccurrencesReceived: number;
  numberOfOccurrencesPending: number;
  receiptProgressPercentage: number;
}
```

### Phase 2: Occurrence Calculation Logic

#### 2.1 Calculate Expected Occurrences

**Function:** `calculateExpectedOccurrences()`
**Location:** `/src/functions/outflows/utils/calculateExpectedOccurrences.ts`

```typescript
interface OccurrenceCalculationInput {
  outflowFrequency: 'WEEKLY' | 'BIWEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY' | 'ANNUALLY';
  periodType: 'MONTHLY' | 'WEEKLY' | 'BI_MONTHLY';
  periodStartDate: Timestamp;
  periodEndDate: Timestamp;
  averageAmount: number;
  predictedNextDate?: Timestamp;
}

interface OccurrenceCalculationResult {
  expectedCount: number;         // How many occurrences
  dueDates: Timestamp[];         // When each is due
  amounts: number[];             // Amount for each occurrence
}

/**
 * Calculate expected occurrences for an outflow within a period
 *
 * Examples:
 * - WEEKLY outflow in MONTHLY period = 4 occurrences
 * - BIWEEKLY outflow in MONTHLY period = 2 occurrences
 * - MONTHLY outflow in MONTHLY period = 1 occurrence
 * - WEEKLY outflow in BI_MONTHLY period = 8 occurrences
 */
export function calculateExpectedOccurrences(
  input: OccurrenceCalculationInput
): OccurrenceCalculationResult {
  const { outflowFrequency, periodType, periodStartDate, periodEndDate, averageAmount } = input;

  // Case 1: Same frequency (no multi-occurrence)
  if (outflowFrequency === periodType) {
    return {
      expectedCount: 1,
      dueDates: [predictedNextDate || periodStartDate],
      amounts: [averageAmount]
    };
  }

  // Case 2: Weekly in Monthly
  if (outflowFrequency === 'WEEKLY' && periodType === 'MONTHLY') {
    return calculateWeeklyInMonthly(periodStartDate, periodEndDate, averageAmount);
  }

  // Case 3: BiWeekly in Monthly
  if (outflowFrequency === 'BIWEEKLY' && periodType === 'MONTHLY') {
    return calculateBiWeeklyInMonthly(periodStartDate, periodEndDate, averageAmount);
  }

  // Case 4: Weekly in BiMonthly
  if (outflowFrequency === 'WEEKLY' && periodType === 'BI_MONTHLY') {
    return calculateWeeklyInBiMonthly(periodStartDate, periodEndDate, averageAmount);
  }

  // Add more cases as needed...

  // Default: Single occurrence
  return {
    expectedCount: 1,
    dueDates: [periodStartDate],
    amounts: [averageAmount]
  };
}

/**
 * Helper: Calculate weekly occurrences in a monthly period
 */
function calculateWeeklyInMonthly(
  periodStart: Timestamp,
  periodEnd: Timestamp,
  amount: number
): OccurrenceCalculationResult {
  const dueDates: Timestamp[] = [];
  const amounts: number[] = [];

  // Start from period start, add 7 days each iteration
  let currentDate = periodStart.toDate();
  const endDate = periodEnd.toDate();

  while (currentDate <= endDate) {
    dueDates.push(Timestamp.fromDate(currentDate));
    amounts.push(amount);
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return {
    expectedCount: dueDates.length,
    dueDates,
    amounts
  };
}

// Similar helpers for other frequency combinations...
```

#### 2.2 Initialize Occurrence Arrays

**Function:** `initializeOccurrenceArrays()`
**Location:** `/src/functions/outflows/utils/initializeOccurrenceArrays.ts`

```typescript
/**
 * Initialize empty occurrence tracking arrays
 */
export function initializeOccurrenceArrays(
  expectedCount: number,
  dueDates: Timestamp[],
  amounts: number[]
): OutflowPeriod['occurrences'] {
  return {
    expectedCount,
    paidStatus: Array(expectedCount).fill(false),
    transactionIds: Array(expectedCount).fill(null),
    dueDates,
    amounts
  };
}
```

### Phase 3: Transaction Auto-Assignment

#### 3.1 Auto-Match Single Transaction to Occurrence

**Function:** `autoMatchTransactionToOccurrence()`
**Location:** `/src/functions/outflows/utils/autoMatchTransactionToOccurrence.ts`

```typescript
interface AutoMatchInput {
  outflowPeriod: OutflowPeriod;
  transaction: {
    id: string;
    date: Timestamp;
    amount: number;
  };
}

interface AutoMatchResult {
  matched: boolean;
  occurrenceIndex?: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

/**
 * Auto-assign a transaction to the best matching occurrence
 *
 * Matching Algorithm:
 * 1. Find occurrences not yet paid
 * 2. Calculate date proximity to each unpaid occurrence
 * 3. Check amount similarity
 * 4. Assign to closest match with confidence score
 */
export function autoMatchTransactionToOccurrence(
  input: AutoMatchInput
): AutoMatchResult {
  const { outflowPeriod, transaction } = input;
  const { occurrences } = outflowPeriod;

  // Find unpaid occurrences
  const unpaidIndices = occurrences.paidStatus
    .map((paid, index) => (!paid ? index : -1))
    .filter(index => index !== -1);

  if (unpaidIndices.length === 0) {
    return {
      matched: false,
      reason: 'All occurrences already paid'
    };
  }

  // Calculate date proximity for each unpaid occurrence
  const transactionDate = transaction.date.toDate();
  const matches = unpaidIndices.map(index => {
    const dueDate = occurrences.dueDates[index].toDate();
    const expectedAmount = occurrences.amounts[index];

    // Date proximity in days
    const dateDiff = Math.abs(transactionDate.getTime() - dueDate.getTime());
    const daysDiff = dateDiff / (1000 * 60 * 60 * 24);

    // Amount similarity percentage
    const amountDiff = Math.abs(transaction.amount - expectedAmount);
    const amountSimilarity = 1 - (amountDiff / expectedAmount);

    // Scoring algorithm
    const dateScore = Math.max(0, 1 - (daysDiff / 7)); // Within 7 days = good
    const amountScore = Math.max(0, amountSimilarity); // Exact match = 1.0
    const totalScore = (dateScore * 0.6) + (amountScore * 0.4);

    return {
      index,
      daysDiff,
      amountDiff,
      totalScore
    };
  });

  // Find best match
  const bestMatch = matches.reduce((best, current) =>
    current.totalScore > best.totalScore ? current : best
  );

  // Determine confidence level
  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (bestMatch.totalScore > 0.8) {
    confidence = 'HIGH';
  } else if (bestMatch.totalScore > 0.5) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  return {
    matched: true,
    occurrenceIndex: bestMatch.index,
    confidence,
    reason: `Matched to occurrence ${bestMatch.index + 1}: ${bestMatch.daysDiff.toFixed(1)} days from due date, $${bestMatch.amountDiff.toFixed(2)} amount difference`
  };
}
```

#### 3.2 Batch Auto-Assignment

**Function:** `autoAssignTransactionsToOccurrences()`
**Location:** `/src/functions/outflows/utils/autoAssignTransactionsToOccurrences.ts`

```typescript
/**
 * Auto-assign multiple transactions to their best matching occurrences
 *
 * Use Cases:
 * - Bulk import of historical transactions
 * - Re-processing after manual corrections
 * - Migration of existing transaction linkages
 */
export async function autoAssignTransactionsToOccurrences(
  outflowPeriodId: string,
  transactionIds: string[]
): Promise<{
  assigned: number;
  skipped: number;
  errors: string[];
}> {
  const db = getFirestore();
  const results = {
    assigned: 0,
    skipped: 0,
    errors: [] as string[]
  };

  // Fetch outflow period
  const periodDoc = await db.collection('outflow_periods').doc(outflowPeriodId).get();
  if (!periodDoc.exists) {
    results.errors.push('Outflow period not found');
    return results;
  }

  const outflowPeriod = periodDoc.data() as OutflowPeriod;

  // Fetch all transactions
  const transactionDocs = await db.collection('transactions')
    .where(FieldPath.documentId(), 'in', transactionIds)
    .get();

  const transactions = transactionDocs.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  // Match each transaction
  for (const transaction of transactions) {
    const matchResult = autoMatchTransactionToOccurrence({
      outflowPeriod,
      transaction: {
        id: transaction.id,
        date: transaction.date,
        amount: transaction.amount
      }
    });

    if (matchResult.matched && matchResult.occurrenceIndex !== undefined) {
      // Update occurrence arrays
      outflowPeriod.occurrences.paidStatus[matchResult.occurrenceIndex] = true;
      outflowPeriod.occurrences.transactionIds[matchResult.occurrenceIndex] = transaction.id;
      results.assigned++;

      console.log(`[autoAssign] Transaction ${transaction.id} assigned to occurrence ${matchResult.occurrenceIndex + 1} (${matchResult.confidence} confidence)`);
    } else {
      results.skipped++;
      console.log(`[autoAssign] Transaction ${transaction.id} skipped: ${matchResult.reason}`);
    }
  }

  // Save updated outflow period
  await periodDoc.ref.update({
    'occurrences.paidStatus': outflowPeriod.occurrences.paidStatus,
    'occurrences.transactionIds': outflowPeriod.occurrences.transactionIds,
    numberOfOccurrencesPaid: outflowPeriod.occurrences.paidStatus.filter(p => p).length,
    numberOfOccurrencesUnpaid: outflowPeriod.occurrences.paidStatus.filter(p => !p).length,
    updatedAt: Timestamp.now()
  });

  return results;
}
```

### Phase 4: Firestore Triggers

#### 4.1 On Outflow Period Created

**Trigger:** `onOutflowPeriodCreate`
**Location:** `/src/functions/outflows/orchestration/triggers/onOutflowPeriodCreate.ts`

```typescript
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { calculateExpectedOccurrences } from '../../utils/calculateExpectedOccurrences';
import { initializeOccurrenceArrays } from '../../utils/initializeOccurrenceArrays';

/**
 * When a new outflow_period is created:
 * 1. Calculate expected occurrences based on frequency mismatch
 * 2. Initialize occurrence tracking arrays
 * 3. Update the document with occurrence data
 */
export const onOutflowPeriodCreated = onDocumentCreated(
  'outflow_periods/{periodId}',
  async (event) => {
    const periodData = event.data?.data();
    if (!periodData) return;

    console.log(`[onOutflowPeriodCreated] Processing period: ${event.params.periodId}`);

    // Get parent outflow document for frequency info
    const outflowDoc = await getFirestore()
      .collection('outflows')
      .doc(periodData.outflowId)
      .get();

    if (!outflowDoc.exists) {
      console.error('[onOutflowPeriodCreated] Parent outflow not found');
      return;
    }

    const outflow = outflowDoc.data() as Outflow;

    // Calculate expected occurrences
    const occurrenceData = calculateExpectedOccurrences({
      outflowFrequency: outflow.frequency,
      periodType: periodData.periodType,
      periodStartDate: periodData.periodStartDate,
      periodEndDate: periodData.periodEndDate,
      averageAmount: outflow.averageAmount,
      predictedNextDate: outflow.predictedNextDate
    });

    // Initialize occurrence arrays
    const occurrences = initializeOccurrenceArrays(
      occurrenceData.expectedCount,
      occurrenceData.dueDates,
      occurrenceData.amounts
    );

    // Update outflow period with occurrence data
    await event.data.ref.update({
      occurrences,
      numberOfOccurrencesInPeriod: occurrenceData.expectedCount,
      numberOfOccurrencesPaid: 0,
      numberOfOccurrencesUnpaid: occurrenceData.expectedCount,
      paymentProgressPercentage: 0,
      updatedAt: Timestamp.now()
    });

    console.log(`[onOutflowPeriodCreated] Initialized ${occurrenceData.expectedCount} occurrences for period ${event.params.periodId}`);
  }
);
```

#### 4.2 On Transaction Created/Updated

**Trigger:** `onTransactionWritten`
**Location:** `/src/functions/transactions/orchestration/triggers/onTransactionWritten.ts`

```typescript
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { autoMatchTransactionToOccurrence } from '../../outflows/utils/autoMatchTransactionToOccurrence';

/**
 * When a transaction is created or updated:
 * 1. Find matching outflow (existing logic)
 * 2. Find relevant outflow_period for transaction date
 * 3. Auto-assign to best matching occurrence
 * 4. Update occurrence arrays
 * 5. Trigger summary update
 */
export const onTransactionWritten = onDocumentWritten(
  'transactions/{transactionId}',
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    // Skip if deleted
    if (!afterData) return;

    // Skip if already processed
    if (beforeData && beforeData.outflowAssignments === afterData.outflowAssignments) {
      return;
    }

    console.log(`[onTransactionWritten] Processing transaction: ${event.params.transactionId}`);

    // Find matching outflow (existing logic - simplified here)
    const matchingOutflowId = await findMatchingOutflow(afterData);
    if (!matchingOutflowId) {
      console.log('[onTransactionWritten] No matching outflow found');
      return;
    }

    // Find relevant outflow_period
    const outflowPeriods = await getFirestore()
      .collection('outflow_periods')
      .where('outflowId', '==', matchingOutflowId)
      .where('periodStartDate', '<=', afterData.date)
      .where('periodEndDate', '>=', afterData.date)
      .limit(1)
      .get();

    if (outflowPeriods.empty) {
      console.log('[onTransactionWritten] No matching outflow period found');
      return;
    }

    const periodDoc = outflowPeriods.docs[0];
    const outflowPeriod = periodDoc.data() as OutflowPeriod;

    // Auto-match to occurrence
    const matchResult = autoMatchTransactionToOccurrence({
      outflowPeriod,
      transaction: {
        id: event.params.transactionId,
        date: afterData.date,
        amount: afterData.amount
      }
    });

    if (!matchResult.matched || matchResult.occurrenceIndex === undefined) {
      console.log(`[onTransactionWritten] Could not match to occurrence: ${matchResult.reason}`);
      return;
    }

    // Update occurrence arrays
    const updatedOccurrences = { ...outflowPeriod.occurrences };
    updatedOccurrences.paidStatus[matchResult.occurrenceIndex] = true;
    updatedOccurrences.transactionIds[matchResult.occurrenceIndex] = event.params.transactionId;

    const paidCount = updatedOccurrences.paidStatus.filter(p => p).length;
    const unpaidCount = updatedOccurrences.expectedCount - paidCount;
    const progressPercentage = Math.round((paidCount / updatedOccurrences.expectedCount) * 100);

    await periodDoc.ref.update({
      'occurrences.paidStatus': updatedOccurrences.paidStatus,
      'occurrences.transactionIds': updatedOccurrences.transactionIds,
      numberOfOccurrencesPaid: paidCount,
      numberOfOccurrencesUnpaid: unpaidCount,
      paymentProgressPercentage: progressPercentage,
      updatedAt: Timestamp.now()
    });

    console.log(`[onTransactionWritten] Assigned transaction to occurrence ${matchResult.occurrenceIndex + 1} with ${matchResult.confidence} confidence`);

    // Trigger summary update
    await updateUserPeriodSummary(
      outflowPeriod.userId,
      outflowPeriod.periodType,
      outflowPeriod.periodId
    );
  }
);
```

### Phase 5: Summary Integration

#### 5.1 Update OutflowEntry in Summary

**Function:** `calculateOutflowSummary()`
**Location:** `/src/functions/summaries/utils/calculateOutflowSummary.ts`

The existing implementation already includes the necessary fields:
- `fullyPaidCount` = `numberOfOccurrencesPaid`
- `unpaidCount` = `numberOfOccurrencesUnpaid`
- `itemCount` = `numberOfOccurrencesInPeriod`
- `paymentProgressPercentage` = percentage calculated from occurrences

**Enhancement:** Add optional occurrence-level details to OutflowEntry:

```typescript
export interface OutflowEntry {
  // ... existing fields ...

  // === OCCURRENCE DETAILS (Optional - for expanded view) ===
  occurrenceDetails?: {
    expectedCount: number;
    paidStatus: boolean[];
    dueDates: Timestamp[];
    amounts: number[];
    transactionIds: (string | null)[];
  };
}
```

**Updated calculation logic:**

```typescript
if (includeEntries) {
  const entry: OutflowEntry = {
    // ... existing fields ...

    // Add occurrence details for multi-occurrence periods
    occurrenceDetails: outflowPeriod.occurrences?.expectedCount > 1
      ? {
          expectedCount: outflowPeriod.occurrences.expectedCount,
          paidStatus: outflowPeriod.occurrences.paidStatus,
          dueDates: outflowPeriod.occurrences.dueDates,
          amounts: outflowPeriod.occurrences.amounts,
          transactionIds: outflowPeriod.occurrences.transactionIds
        }
      : undefined
  };
  entries.push(entry);
}
```

---

## Edge Cases and Special Scenarios

### Edge Case 1: Partial Month Coverage

**Scenario:** Weekly bill starts mid-month

**Example:**
- Bill starts Nov 15
- Monthly period: Nov 1-30
- Expected: 2 occurrences (Nov 15, Nov 22), not 4

**Solution:**
```typescript
function calculateWeeklyInMonthly(periodStart, periodEnd, firstDueDate) {
  // Start from firstDueDate if it's later than periodStart
  const startDate = firstDueDate > periodStart ? firstDueDate : periodStart;

  let currentDate = startDate.toDate();
  const endDate = periodEnd.toDate();
  const dueDates = [];

  while (currentDate <= endDate) {
    dueDates.push(Timestamp.fromDate(currentDate));
    currentDate.setDate(currentDate.getDate() + 7);
  }

  return {
    expectedCount: dueDates.length,
    dueDates,
    amounts: Array(dueDates.length).fill(averageAmount)
  };
}
```

### Edge Case 2: Amount Variations

**Scenario:** Bill amount varies slightly between occurrences

**Example:**
- Netflix usually $15.99, but one charge is $16.49 (price increase)

**Solution:**
- Use fuzzy amount matching (within 10% tolerance)
- Log amount discrepancies for user review
- Allow manual override of auto-assignment

```typescript
// In autoMatchTransactionToOccurrence
const amountTolerance = expectedAmount * 0.10; // 10% tolerance
const amountDiff = Math.abs(transaction.amount - expectedAmount);
const withinTolerance = amountDiff <= amountTolerance;

if (!withinTolerance) {
  console.warn(`Amount variance detected: expected ${expectedAmount}, got ${transaction.amount}`);
  // Still match but with MEDIUM confidence
  confidence = 'MEDIUM';
}
```

### Edge Case 3: Missing Transactions

**Scenario:** Expected 4 weekly payments, only 3 arrived

**Current State:**
```typescript
occurrences: {
  expectedCount: 4,
  paidStatus: [true, true, true, false],
  transactionIds: ['txn_1', 'txn_2', 'txn_3', null]
}
```

**User Experience:**
- Summary shows: "3/4 paid - $15.99 outstanding"
- Status: PARTIAL (not OVERDUE unless due date passed)
- Next action: Alert user if due date + grace period passed

**Implementation:**
```typescript
// In calculateOutflowSummary
const now = Timestamp.now();
const overdueOccurrences = outflowPeriod.occurrences.paidStatus
  .map((paid, index) => {
    if (paid) return false;
    const dueDate = outflowPeriod.occurrences.dueDates[index];
    const gracePeriod = 3; // 3 days
    const dueDatePlusGrace = new Date(dueDate.toDate());
    dueDatePlusGrace.setDate(dueDatePlusGrace.getDate() + gracePeriod);
    return Timestamp.fromDate(dueDatePlusGrace) < now;
  })
  .filter(isOverdue => isOverdue);

if (overdueOccurrences.length > 0) {
  entry.status = OutflowPeriodStatus.OVERDUE;
  entry.overdueCount = overdueOccurrences.length;
}
```

### Edge Case 4: Transaction Date Ambiguity

**Scenario:** Two occurrences have similar due dates, transaction could match either

**Example:**
- Occurrence 1: Due Nov 7
- Occurrence 2: Due Nov 14
- Transaction: Nov 10 (equidistant)

**Solution:**
- Match to earlier unpaid occurrence first
- Log ambiguous matches for user review
- Provide manual override UI

```typescript
// In autoMatchTransactionToOccurrence
if (matches.length > 1 && Math.abs(matches[0].totalScore - matches[1].totalScore) < 0.1) {
  console.warn(`Ambiguous match detected for transaction ${transaction.id}`);
  // Match to earlier occurrence
  return matches.sort((a, b) => a.index - b.index)[0];
}
```

### Edge Case 5: Manual Transaction Reassignment

**Scenario:** User manually reassigns transaction to different occurrence

**Implementation:**
```typescript
// Callable function for manual override
export const reassignTransactionToOccurrence = onCall(async (request) => {
  const { outflowPeriodId, transactionId, occurrenceIndex } = request.data;

  // Validate ownership
  const periodDoc = await db.collection('outflow_periods').doc(outflowPeriodId).get();
  if (periodDoc.data().userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Not your outflow period');
  }

  // Clear old assignment (if any)
  const occurrences = periodDoc.data().occurrences;
  const oldIndex = occurrences.transactionIds.indexOf(transactionId);
  if (oldIndex !== -1) {
    occurrences.paidStatus[oldIndex] = false;
    occurrences.transactionIds[oldIndex] = null;
  }

  // Set new assignment
  occurrences.paidStatus[occurrenceIndex] = true;
  occurrences.transactionIds[occurrenceIndex] = transactionId;

  // Recalculate counts
  const paidCount = occurrences.paidStatus.filter(p => p).length;

  // Save
  await periodDoc.ref.update({
    'occurrences.paidStatus': occurrences.paidStatus,
    'occurrences.transactionIds': occurrences.transactionIds,
    numberOfOccurrencesPaid: paidCount,
    numberOfOccurrencesUnpaid: occurrences.expectedCount - paidCount,
    paymentProgressPercentage: Math.round((paidCount / occurrences.expectedCount) * 100),
    updatedAt: Timestamp.now()
  });

  // Trigger summary update
  await updateUserPeriodSummary(
    periodDoc.data().userId,
    periodDoc.data().periodType,
    periodDoc.data().periodId
  );

  return { success: true };
});
```

---

## Performance Considerations

### Query Optimization

**Concern:** Fetching transactions to match against occurrences

**Solution:**
- Index on `date` + `userId` for efficient transaction queries
- Batch process during low-traffic periods
- Cache outflow period documents for repeated lookups

**Indexes Needed:**
```json
{
  "collectionGroup": "transactions",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "date", "order": "ASCENDING" }
  ]
},
{
  "collectionGroup": "outflow_periods",
  "fields": [
    { "fieldPath": "outflowId", "order": "ASCENDING" },
    { "fieldPath": "periodStartDate", "order": "ASCENDING" }
  ]
}
```

### Document Size Limits

**Concern:** Large occurrence arrays in high-frequency scenarios

**Analysis:**
- Weekly bill in bi-monthly period = 8 occurrences
- Each occurrence = ~200 bytes (timestamp, bool, string)
- Total = 1.6KB (negligible)

**Worst Case:**
- Daily bill in monthly period = 30 occurrences
- Total = 6KB (still well within 1MB limit)

**Conclusion:** Document size is not a concern for realistic scenarios.

### Real-time Summary Updates

**Concern:** Triggering summary recalculation on every transaction

**Solution:**
- Use batching for bulk imports
- Debounce summary updates (max 1 per minute per period)
- Queue summary updates for background processing

```typescript
// In onTransactionWritten trigger
const updateKey = `${outflowPeriod.userId}_${outflowPeriod.periodType}_${outflowPeriod.periodId}`;
const lastUpdate = await getLastSummaryUpdate(updateKey);

if (Date.now() - lastUpdate < 60000) {
  // Queue for later
  await queueSummaryUpdate(updateKey);
} else {
  // Update immediately
  await updateUserPeriodSummary(...);
  await setLastSummaryUpdate(updateKey, Date.now());
}
```

---

## Testing Strategy

### Unit Tests

**Test File:** `/src/functions/outflows/utils/__tests__/calculateExpectedOccurrences.test.ts`

```typescript
describe('calculateExpectedOccurrences', () => {
  test('weekly bill in monthly period = 4 occurrences', () => {
    const result = calculateExpectedOccurrences({
      outflowFrequency: 'WEEKLY',
      periodType: 'MONTHLY',
      periodStartDate: Timestamp.fromDate(new Date('2025-11-01')),
      periodEndDate: Timestamp.fromDate(new Date('2025-11-30')),
      averageAmount: 15.99
    });

    expect(result.expectedCount).toBe(4);
    expect(result.dueDates).toHaveLength(4);
    expect(result.amounts).toEqual([15.99, 15.99, 15.99, 15.99]);
  });

  test('biweekly bill in monthly period = 2 occurrences', () => {
    // ... test implementation
  });

  test('monthly bill in monthly period = 1 occurrence', () => {
    // ... test implementation
  });
});
```

**Test File:** `/src/functions/outflows/utils/__tests__/autoMatchTransactionToOccurrence.test.ts`

```typescript
describe('autoMatchTransactionToOccurrence', () => {
  test('matches transaction to closest due date', () => {
    const outflowPeriod = {
      occurrences: {
        expectedCount: 4,
        paidStatus: [true, false, false, false],
        transactionIds: ['txn_1', null, null, null],
        dueDates: [
          Timestamp.fromDate(new Date('2025-11-07')),
          Timestamp.fromDate(new Date('2025-11-14')),
          Timestamp.fromDate(new Date('2025-11-21')),
          Timestamp.fromDate(new Date('2025-11-28'))
        ],
        amounts: [15.99, 15.99, 15.99, 15.99]
      }
    };

    const transaction = {
      id: 'txn_2',
      date: Timestamp.fromDate(new Date('2025-11-15')),
      amount: 15.99
    };

    const result = autoMatchTransactionToOccurrence({ outflowPeriod, transaction });

    expect(result.matched).toBe(true);
    expect(result.occurrenceIndex).toBe(1); // Nov 14 occurrence
    expect(result.confidence).toBe('HIGH');
  });

  test('handles amount variance within tolerance', () => {
    // ... test implementation
  });

  test('returns low confidence for large date difference', () => {
    // ... test implementation
  });
});
```

### Integration Tests

**Test Scenario 1: End-to-End Auto-Assignment**

```typescript
describe('Multi-Occurrence Auto-Assignment Flow', () => {
  test('creates period → matches transactions → updates summary', async () => {
    // 1. Create outflow with weekly frequency
    const outflowId = await createOutflow({
      frequency: 'WEEKLY',
      averageAmount: 15.99
    });

    // 2. Create monthly outflow_period
    const periodId = await createOutflowPeriod({
      outflowId,
      periodType: 'MONTHLY',
      periodStartDate: new Date('2025-11-01'),
      periodEndDate: new Date('2025-11-30')
    });

    // 3. Verify 4 occurrences initialized
    const period = await getOutflowPeriod(periodId);
    expect(period.occurrences.expectedCount).toBe(4);
    expect(period.numberOfOccurrencesPaid).toBe(0);

    // 4. Create matching transactions
    await createTransaction({ date: new Date('2025-11-07'), amount: 15.99 });
    await createTransaction({ date: new Date('2025-11-14'), amount: 15.99 });

    // 5. Wait for triggers to process
    await wait(2000);

    // 6. Verify auto-assignment
    const updatedPeriod = await getOutflowPeriod(periodId);
    expect(updatedPeriod.numberOfOccurrencesPaid).toBe(2);
    expect(updatedPeriod.occurrences.paidStatus).toEqual([true, true, false, false]);

    // 7. Verify summary updated
    const summary = await getUserPeriodSummary(userId, 'MONTHLY', '2025-M11');
    const outflowEntry = summary.outflows.entries.find(e => e.outflowPeriodId === periodId);
    expect(outflowEntry.fullyPaidCount).toBe(2);
    expect(outflowEntry.unpaidCount).toBe(2);
    expect(outflowEntry.paymentProgressPercentage).toBe(50);
  });
});
```

### Manual Testing Checklist

- [ ] Create weekly bill in monthly period
- [ ] Verify 4 occurrences initialized
- [ ] Add 1st transaction, verify auto-assignment
- [ ] Add 2nd transaction, verify progress updates
- [ ] View summary, verify correct counts
- [ ] Test amount variance handling
- [ ] Test manual reassignment
- [ ] Test partial payment scenarios
- [ ] Test overdue detection
- [ ] Test different frequency combinations

---

## Migration Strategy

### Phase M1: Add Occurrence Fields (Non-Breaking)

**Target:** Existing `outflow_periods` and `inflow_periods` documents

**Script:** `migrations/addOccurrenceFieldsToExistingPeriods.ts`

```typescript
/**
 * Migration: Add occurrence tracking to existing periods
 *
 * For each existing period:
 * 1. If already has occurrences field, skip
 * 2. Calculate expected occurrences based on frequency
 * 3. Initialize empty occurrence arrays
 * 4. Update document
 */
async function migrateExistingPeriodsToOccurrences() {
  const db = getFirestore();

  // Query all outflow_periods without occurrences field
  const periodsSnapshot = await db.collection('outflow_periods')
    .where('occurrences', '==', null)
    .get();

  console.log(`Found ${periodsSnapshot.size} periods to migrate`);

  const batch = db.batch();
  let batchCount = 0;

  for (const periodDoc of periodsSnapshot.docs) {
    const period = periodDoc.data();

    // Get parent outflow for frequency
    const outflowDoc = await db.collection('outflows').doc(period.outflowId).get();
    if (!outflowDoc.exists) continue;

    const outflow = outflowDoc.data();

    // Calculate occurrences
    const occurrenceData = calculateExpectedOccurrences({
      outflowFrequency: outflow.frequency,
      periodType: period.periodType,
      periodStartDate: period.periodStartDate,
      periodEndDate: period.periodEndDate,
      averageAmount: outflow.averageAmount
    });

    // Initialize arrays
    const occurrences = initializeOccurrenceArrays(
      occurrenceData.expectedCount,
      occurrenceData.dueDates,
      occurrenceData.amounts
    );

    // Check if period has existing transactions
    // If so, attempt to auto-assign them
    if (period.transactionIds && period.transactionIds.length > 0) {
      for (const txnId of period.transactionIds) {
        const txnDoc = await db.collection('transactions').doc(txnId).get();
        if (!txnDoc.exists) continue;

        const txn = txnDoc.data();
        const matchResult = autoMatchTransactionToOccurrence({
          outflowPeriod: { ...period, occurrences },
          transaction: {
            id: txnId,
            date: txn.date,
            amount: txn.amount
          }
        });

        if (matchResult.matched && matchResult.occurrenceIndex !== undefined) {
          occurrences.paidStatus[matchResult.occurrenceIndex] = true;
          occurrences.transactionIds[matchResult.occurrenceIndex] = txnId;
        }
      }
    }

    // Calculate counts
    const paidCount = occurrences.paidStatus.filter(p => p).length;

    // Batch update
    batch.update(periodDoc.ref, {
      occurrences,
      numberOfOccurrencesInPeriod: occurrenceData.expectedCount,
      numberOfOccurrencesPaid: paidCount,
      numberOfOccurrencesUnpaid: occurrenceData.expectedCount - paidCount,
      paymentProgressPercentage: Math.round((paidCount / occurrenceData.expectedCount) * 100),
      updatedAt: Timestamp.now()
    });

    batchCount++;

    // Commit batch every 500 documents
    if (batchCount >= 500) {
      await batch.commit();
      console.log(`Committed batch of ${batchCount} updates`);
      batchCount = 0;
    }
  }

  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${batchCount} updates`);
  }

  console.log('Migration complete!');
}
```

**Rollback Plan:**
- Keep backup of `outflow_periods` collection before migration
- If issues arise, restore from backup
- New `occurrences` field won't break existing code (optional field)

### Phase M2: Enable Auto-Assignment Triggers

**Deployment:**
1. Deploy new Cloud Functions with auto-assignment logic
2. Monitor logs for assignment success rates
3. Flag low-confidence assignments for manual review

**Gradual Rollout:**
- Week 1: Enable for test users only
- Week 2: Enable for 10% of users
- Week 3: Enable for 50% of users
- Week 4: Enable for all users

### Phase M3: Migrate Summaries

**Target:** Regenerate all `user_summaries` with occurrence details

**Script:** `migrations/regenerateUserSummariesWithOccurrences.ts`

```typescript
async function regenerateAllUserSummaries() {
  const db = getFirestore();

  // Get all unique user + period combinations
  const summaries = await db.collection('user_summaries').get();

  console.log(`Regenerating ${summaries.size} user summaries`);

  for (const summaryDoc of summaries.docs) {
    const summary = summaryDoc.data();

    // Re-run updateUserPeriodSummary
    await updateUserPeriodSummary(
      summary.userId,
      summary.periodType,
      summary.sourcePeriodId,
      true // includeEntries
    );

    console.log(`Regenerated summary: ${summaryDoc.id}`);
  }

  console.log('Summary regeneration complete!');
}
```

---

## Success Metrics

### Technical Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Auto-Assignment Success Rate | >90% | % of transactions matched with HIGH confidence |
| Average Assignment Latency | <500ms | Time from transaction creation to occurrence update |
| Summary Update Latency | <2s | Time from occurrence update to summary refresh |
| Migration Completion | 100% | % of existing periods with occurrence fields |

### User Experience Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Manual Override Rate | <5% | % of transactions manually reassigned |
| User Confusion Reports | <1% | % of users reporting confusion about multi-occurrence |
| Feature Adoption | >50% | % of users viewing occurrence details |

### Business Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Bill Payment Accuracy | +15% | Improvement in on-time payment tracking |
| Cash Flow Forecast Accuracy | +20% | Reduction in forecast variance |
| User Engagement | +10% | Increase in app session duration |

---

## Risk Assessment

### High Risk: Auto-Assignment Errors

**Risk:** System assigns transaction to wrong occurrence

**Impact:** User sees incorrect payment status, potential late fees

**Mitigation:**
- Conservative confidence thresholds
- Flag ambiguous matches for manual review
- Provide clear undo/reassign UI
- Log all assignments for debugging

### Medium Risk: Performance Degradation

**Risk:** Real-time triggers slow down transaction processing

**Impact:** Delayed UI updates, poor user experience

**Mitigation:**
- Batch process during bulk imports
- Queue summary updates for background processing
- Monitor Cloud Function execution times
- Scale up resources if needed

### Low Risk: Data Migration Issues

**Risk:** Migration script fails to assign existing transactions

**Impact:** Some periods show incomplete payment history

**Mitigation:**
- Run migration in dry-run mode first
- Keep backup of original data
- Provide admin tool to re-run migration for specific users
- Manual override always available

---

## Implementation Priorities

### P0 (Must Have - MVP)

- [ ] **Phase 1:** OutflowPeriod occurrence fields
- [ ] **Phase 2:** Calculate expected occurrences
- [ ] **Phase 3:** Auto-match transaction to occurrence
- [ ] **Phase 4:** onOutflowPeriodCreate trigger
- [ ] **Phase 4:** onTransactionWritten trigger enhancement
- [ ] **Phase 5:** Update calculateOutflowSummary with occurrence details
- [ ] **Migration:** Add occurrence fields to existing periods

### P1 (Should Have - Post-MVP)

- [ ] Manual reassignment UI
- [ ] Confidence-based alerts for user review
- [ ] InflowPeriod multi-occurrence support
- [ ] Batch auto-assignment utility
- [ ] Admin debugging tools
- [ ] Performance monitoring dashboard

### P2 (Nice to Have - Future)

- [ ] Machine learning for improved matching
- [ ] Predictive alerts for missed payments
- [ ] Occurrence-level notes/attachments
- [ ] Recurring transaction detection improvements
- [ ] Multi-currency occurrence handling

---

## Next Steps

### Immediate Actions (Before Implementation)

1. **Review this plan** - Make any necessary adjustments
2. **Confirm data model** - Ensure occurrence arrays meet all use cases
3. **Validate edge cases** - Identify any missing scenarios
4. **Approve implementation phases** - Decide on MVP scope

### Implementation Order

**Week 1: Foundation**
- Implement `calculateExpectedOccurrences()`
- Add occurrence fields to OutflowPeriod type
- Write unit tests for calculation logic

**Week 2: Auto-Assignment**
- Implement `autoMatchTransactionToOccurrence()`
- Write unit tests for matching algorithm
- Test with sample data

**Week 3: Triggers**
- Implement `onOutflowPeriodCreated` trigger
- Enhance `onTransactionWritten` trigger
- Test end-to-end flow

**Week 4: Summary Integration**
- Update `calculateOutflowSummary()` with occurrence details
- Regenerate test summaries
- Verify frontend rendering

**Week 5: Migration & Testing**
- Run migration script on test data
- Conduct integration testing
- Performance testing and optimization

**Week 6: Deployment**
- Deploy to staging environment
- User acceptance testing
- Gradual rollout to production

---

## Questions for Review

1. **Occurrence Array Structure:** Is the parallel array approach (paidStatus, transactionIds, dueDates) acceptable, or would a nested object array be better?

2. **Confidence Thresholds:** What confidence level should trigger manual review alerts? (Currently: MEDIUM and LOW)

3. **Grace Periods:** How many days grace period before marking occurrence as overdue? (Currently: 3 days)

4. **Amount Tolerance:** What percentage variance should be allowed for amount matching? (Currently: 10%)

5. **Summary Details:** Should occurrence-level details be included in summaries by default, or only on request?

6. **Migration Scope:** Should we migrate all existing periods, or only periods created in the last 3 months?

7. **Performance:** Should summary updates be synchronous (real-time) or asynchronous (queued)?

8. **Inflows:** Should inflows support multi-occurrence tracking in MVP, or defer to P1?

---

**End of Plan**

This plan is ready for review and implementation. Please provide feedback on any sections that need adjustment or clarification.
