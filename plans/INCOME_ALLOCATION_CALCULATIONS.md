# Income Allocation Calculations - Implementation Plan

## Overview

Enhance the existing inflow period calculation system to properly handle all combinations of income frequency and viewing period type, with clear definitions for Expected, Actual, and Allocated income values.

---

## Existing Implementation (Already Built)

### Utility Functions in `/src/functions/inflows/inflow_periods/utils/`

| File | Purpose | Status |
|------|---------|--------|
| `calculateAllOccurrencesInPeriod.ts` | Calculate occurrences in a period, returns `amountAllocated` | **EXISTS** |
| `alignTransactionsToInflowPeriods.ts` | Match transactions to occurrences | **EXISTS** |
| `calculateInflowPeriodStatus.ts` | Determine RECEIVED/PARTIAL/PENDING/OVERDUE status | **EXISTS** |
| `predictNextPayment.ts` | Predict next payment date/amount | **EXISTS** |
| `runUpdateInflowPeriods.ts` | Propagate inflow changes to periods | **EXISTS** |

### Existing InflowPeriod Fields (from `src/types/index.ts`)

```typescript
// Already exists:
actualAmount: number | null;           // Actual received (set when matched)
amountAllocated: number;               // Proportional allocation (amountPerOccurrence × periodDays/cycleDays)
amountWithheld: number;                // Daily rate × period days
averageAmount: number;                 // Expected per occurrence (from Plaid)
expectedAmount: number;                // Total expected for period
totalAmountDue: number;                // occurrences × amount
totalAmountPaid: number;               // Sum of received amounts

// Occurrence tracking (parallel arrays):
occurrenceDueDates: Timestamp[];
occurrencePaidFlags: boolean[];
occurrenceTransactionIds: (string | null)[];
occurrenceAmounts: number[];           // Actual amounts per occurrence
```

### Existing Allocation Formula

From `calculateAllOccurrencesInPeriod.ts`:
```typescript
amountAllocated = amountPerOccurrence × (periodDays / cycleDays)
```

This already handles proportional distribution across periods!

---

## Frequency and Period Type Definitions

### Income Frequencies (from Plaid)

| Frequency | Cycle Days | Description |
|-----------|------------|-------------|
| `UNKNOWN` | Variable | Irregular income |
| `WEEKLY` | 7 | Every week |
| `BIWEEKLY` | 14 | Every 2 weeks |
| `SEMI_MONTHLY` | ~15 | Twice per month (1st & 15th) |
| `MONTHLY` | ~30 | Once per month |
| `QUARTERLY` | ~91 | Every 3 months |
| `ANNUALLY` | 365 | Once per year |

### Viewing Period Types

| PeriodType | Typical Days | Usage |
|------------|--------------|-------|
| `WEEKLY` | 7 | Weekly budget view |
| `BI_MONTHLY` | 14-16 | Bi-monthly budget view |
| `MONTHLY` | 28-31 | Monthly budget view |

---

## Complete Frequency × Period Matrix (21 Combinations)

### Legend
- **Expected**: What we expect based on occurrences in period
- **Actual**: What was actually received (from matched transactions)
- **Allocated**: Amount distributed to this period for budgeting

---

### WEEKLY Income (Cycle: 7 days)

| Viewing Period | Expected Calculation | Actual Calculation | Allocated Calculation |
|----------------|---------------------|--------------------|-----------------------|
| **WEEKLY** | 1 occurrence × amount | Sum of received in period | = Expected (1:1 mapping) |
| **BI_MONTHLY** | 2 occurrences × amount | Sum of received in period | = Expected (direct sum) |
| **MONTHLY** | 4-5 occurrences × amount | Sum of received in period | = Expected (direct sum) |

### BIWEEKLY Income (Cycle: 14 days)

| Viewing Period | Expected Calculation | Actual Calculation | Allocated Calculation |
|----------------|---------------------|--------------------|-----------------------|
| **WEEKLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (7/14) = 50% |
| **BI_MONTHLY** | 1 occurrence × amount | Sum of received in period | = Expected (1:1 mapping) |
| **MONTHLY** | 2-3 occurrences × amount | Sum of received in period | = Expected (direct sum) |

### SEMI_MONTHLY Income (Cycle: ~15 days, 1st & 15th)

| Viewing Period | Expected Calculation | Actual Calculation | Allocated Calculation |
|----------------|---------------------|--------------------|-----------------------|
| **WEEKLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (7/15) ≈ 47% |
| **BI_MONTHLY** | 1 occurrence × amount | Sum of received in period | = Expected (1:1 mapping) |
| **MONTHLY** | 2 occurrences × amount | Sum of received in period | = Expected (direct sum) |

### MONTHLY Income (Cycle: ~30 days)

| Viewing Period | Expected Calculation | Actual Calculation | Allocated Calculation |
|----------------|---------------------|--------------------|-----------------------|
| **WEEKLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (7/30) ≈ 23% |
| **BI_MONTHLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (15/30) = 50% |
| **MONTHLY** | 1 occurrence × amount | Sum of received in period | = Expected (1:1 mapping) |

### QUARTERLY Income (Cycle: ~91 days)

| Viewing Period | Expected Calculation | Actual Calculation | Allocated Calculation |
|----------------|---------------------|--------------------|-----------------------|
| **WEEKLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (7/91) ≈ 7.7% |
| **BI_MONTHLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (15/91) ≈ 16.5% |
| **MONTHLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (30/91) ≈ 33% |

### ANNUALLY Income (Cycle: 365 days)

| Viewing Period | Expected Calculation | Actual Calculation | Allocated Calculation |
|----------------|---------------------|--------------------|-----------------------|
| **WEEKLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (7/365) ≈ 1.9% |
| **BI_MONTHLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (15/365) ≈ 4.1% |
| **MONTHLY** | 0 or 1 occurrence × amount | Sum of received in period | **Proportional**: amount × (30/365) ≈ 8.2% |

### UNKNOWN Frequency

| Viewing Period | Expected Calculation | Actual Calculation | Allocated Calculation |
|----------------|---------------------|--------------------|-----------------------|
| **ALL** | Use rolling average or user input | Sum of received in period | **Proportional** based on estimated cycle |

---

## Key Calculation Rules

### Rule 1: Expected Income
```
expectedIncome = numberOfOccurrencesInPeriod × amountPerOccurrence
```
- Occurrences determined by `calculateAllOccurrencesInPeriod()`
- amountPerOccurrence = userOverride || rollingAverage || plaidAverageAmount

### Rule 2: Actual Income
```
actualIncome = SUM(occurrenceAmounts WHERE occurrencePaidFlags[i] === true)
```
- Already tracked in `totalAmountPaid` field
- Updated by `alignTransactionsToInflowPeriods()`

### Rule 3: Allocated Income (Three Cases)

**Case A: Income frequency >= Viewing period (1:1 or more occurrences)**
```
allocatedIncome = expectedIncome  // Direct sum of all occurrences
```
Examples: WEEKLY→MONTHLY, BIWEEKLY→MONTHLY, MONTHLY→MONTHLY

**Case B: Income frequency < Viewing period (proportional distribution)**
```
allocatedIncome = amountPerOccurrence × (periodDays / cycleDays)
```
Examples: MONTHLY→WEEKLY, BIWEEKLY→WEEKLY, ANNUALLY→MONTHLY

**Case C: After actual is received**
```
// Only update allocation if actual differs significantly from expected
if (allOccurrencesReceived && actualIncome !== expectedIncome) {
  // Adjust future period allocations based on actual
  adjustedAllocation = actualIncome × (periodDays / cycleDays)
}
```

---

## What Needs Enhancement

### 1. Clarify Field Semantics (Documentation)

Current fields are used but semantics need documentation:

| Field | Current Meaning | Proposed Clarification |
|-------|-----------------|------------------------|
| `expectedAmount` | Total expected for period | = expectedIncome (sum of occurrence amounts) |
| `actualAmount` | Single actual amount | Should be `actualIncome` (sum of received) |
| `amountAllocated` | Proportional allocation | = allocatedIncome (for budgeting) |
| `totalAmountPaid` | Sum of received | = actualIncome |

### 2. Add Explicit Allocation Method Field

```typescript
// NEW FIELD
allocationMethod: 'direct' | 'proportional';
// direct = occurrences summed (income >= period)
// proportional = spread across periods (income < period)
```

### 3. Handle 3-Pay Month Edge Case

For BIWEEKLY income viewed MONTHLY, some months have 3 paydays:
- Already handled by `calculateAllOccurrencesInPeriod()` which counts actual occurrences
- **Verification needed**: Ensure all 3 are counted and summed

### 4. Weekend Payday Shift Detection

Add to `calculateAllOccurrencesInPeriod.ts`:
```typescript
function adjustForWeekendPayday(expectedDate: Date): Date {
  const dayOfWeek = expectedDate.getDay();
  if (dayOfWeek === 6) return subDays(expectedDate, 1); // Sat → Fri
  if (dayOfWeek === 0) return subDays(expectedDate, 2); // Sun → Fri
  return expectedDate;
}
```

### 5. Rolling Average Update on Receipt

When actual differs from expected by >10%, update inflow's `averageAmount`:
```typescript
// In alignTransactionsToInflowPeriods.ts after matching
if (Math.abs(actualAmount - expectedAmount) / expectedAmount > 0.10) {
  await updateInflowRollingAverage(inflowId, actualAmount);
}
```

---

## Implementation Phases

### Phase 1: Audit & Verify Existing Logic
- [ ] Verify `calculateAllOccurrencesInPeriod` handles all 7 frequencies
- [ ] Verify 3-pay month case is handled correctly
- [ ] Document current field usage in CLAUDE.md
- [ ] Add unit tests for each frequency × period combination

### Phase 2: Add Weekend Adjustment
- [ ] Add `adjustForWeekendPayday()` function
- [ ] Integrate into occurrence calculation
- [ ] Test with Saturday/Sunday payday scenarios

### Phase 3: Add Rolling Average Updates
- [ ] Create `updateInflowRollingAverage()` function
- [ ] Trigger on significant variance detection
- [ ] Add variance tracking field to InflowPeriod

### Phase 4: Add Allocation Method Tracking
- [ ] Add `allocationMethod` field to InflowPeriod type
- [ ] Set during period creation/update
- [ ] Expose in mobile app for debugging/display

### Phase 5: Integration Testing
- [ ] Test all 21 frequency × period combinations
- [ ] Verify budget calculations use correct values
- [ ] Test actual income updating future allocations

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/functions/inflows/inflow_periods/utils/calculateAllOccurrencesInPeriod.ts` | Add weekend adjustment, verify all frequencies |
| `src/functions/inflows/inflow_periods/utils/alignTransactionsToInflowPeriods.ts` | Add rolling average update trigger |
| `src/types/index.ts` | Add `allocationMethod` field to InflowPeriod |
| `src/functions/inflows/CLAUDE.md` | Document field semantics and calculation rules |

## New Files to Create

| File | Purpose |
|------|---------|
| `src/functions/inflows/inflow_periods/utils/updateInflowRollingAverage.ts` | Rolling average update logic |
| `src/functions/inflows/inflow_periods/utils/__tests__/frequencyMatrix.test.ts` | Test all 21 combinations |

---

## Verification Plan

### Unit Tests for Each Combination
```typescript
describe('Frequency × Period Matrix', () => {
  // WEEKLY income
  test('WEEKLY income → WEEKLY period', ...);
  test('WEEKLY income → BI_MONTHLY period', ...);
  test('WEEKLY income → MONTHLY period', ...);

  // BIWEEKLY income
  test('BIWEEKLY income → WEEKLY period (proportional)', ...);
  test('BIWEEKLY income → BI_MONTHLY period (direct)', ...);
  test('BIWEEKLY income → MONTHLY period (2-3 occurrences)', ...);

  // ... all 21 combinations
});
```

### Edge Case Tests
```typescript
describe('Edge Cases', () => {
  test('3-pay month for BIWEEKLY', ...);
  test('Weekend payday shift to Friday', ...);
  test('Rolling average update on 15% variance', ...);
  test('ANNUALLY income spread across 12 months', ...);
});
```

### Manual Testing
1. Create income with each frequency type
2. View in each period type
3. Verify Expected, Actual, Allocated values
4. Mark occurrences as received with varying amounts
5. Verify rolling average updates

---

## Summary

Most of the core functionality **already exists**. The main enhancements needed are:

1. **Weekend payday adjustment** - Simple addition to occurrence calculation
2. **Rolling average updates** - Trigger when actual varies significantly
3. **Documentation** - Clarify field semantics and add calculation rules
4. **Testing** - Comprehensive tests for all 21 frequency × period combinations
5. **Allocation method field** - Track whether direct or proportional allocation was used

The existing `amountAllocated = amount × (periodDays/cycleDays)` formula already handles proportional distribution correctly.

---

## Status

**Plan Status:** PENDING REVIEW
**Created:** 2026-03-14
**Last Updated:** 2026-03-14
