# Prime/Non-Prime Budget Period System - Quick Reference

## What Changed?

Budget periods now use a Prime/Non-Prime system instead of average-based calculations:

- **Before:** All period types calculated independently using averages (7/30.44 for weekly)
- **After:** Prime periods are authoritative; non-prime periods derive from prime daily rates

## Why This Matters

Ensures spending aligns perfectly across all period views:
- Viewing a $100/month budget as weekly shows the same total spending
- Weeks spanning multiple months correctly allocate from each month's budget
- February (28 days) allocates less than March (31 days) automatically

## Quick Start

### Creating Budget Periods (No Code Changes Required!)

```typescript
// This AUTOMATICALLY uses the new Prime/Non-Prime system
import { generateBudgetPeriodsForNewBudget } from './utils/budgetPeriods';

const result = await generateBudgetPeriodsForNewBudget(db, budgetId, budget);

// OR use the new system directly
import { generateBudgetPeriodsWithPrimeSystem } from './utils/periodGenerationOrchestrator';

const result = await generateBudgetPeriodsWithPrimeSystem(db, budgetId, budget);
```

### Reading Budget Periods

```typescript
const period = await db.collection('budget_periods').doc(periodId).get();
const data = period.data();

// Check if prime or non-prime
if (data.isPrime) {
  console.log('Prime period:', {
    allocatedAmount: data.allocatedAmount,
    dailyRate: data.dailyRate,
    daysInPeriod: data.daysInPeriod,
  });
} else {
  console.log('Non-prime period:', {
    allocatedAmount: data.allocatedAmount,
    derivedFrom: data.primePeriodIds,
    breakdown: data.primePeriodBreakdown,
  });
}

// Safe defaults for existing documents
const isPrime = data.isPrime ?? true;
const dailyRate = data.dailyRate ?? (data.allocatedAmount / getDaysInPeriod(data.periodStart, data.periodEnd));
```

## New Fields on BudgetPeriodDocument

All fields are **optional** for backward compatibility:

```typescript
interface BudgetPeriodDocument {
  // ... existing fields ...

  // === PRIME/NON-PRIME FIELDS (Optional) ===
  isPrime?: boolean;                          // true = prime, false = non-prime
  dailyRate?: number;                         // allocatedAmount / daysInPeriod
  daysInPeriod?: number;                      // Actual days in this period
  primePeriodIds?: string[];                  // IDs of overlapping primes (non-prime only)
  primePeriodBreakdown?: PrimePeriodContribution[]; // Detailed contribution breakdown (non-prime only)
}

interface PrimePeriodContribution {
  primePeriodId: string;      // Which prime contributed
  sourcePeriodId: string;     // Source period ID
  daysContributed: number;    // How many days from this prime
  dailyRate: number;          // Daily rate from this prime
  amountContributed: number;  // daysContributed × dailyRate
  overlapStart: Timestamp;    // Start of overlap
  overlapEnd: Timestamp;      // End of overlap
}
```

## Architecture Overview

```
Budget: $252/month starting Jan 17, 2026

1. GENERATE PRIME PERIODS (match budget.period = MONTHLY)
   ├── Jan 17-31: 15 days, $121.94, dailyRate: $8.13
   ├── Feb 1-28: 28 days, $252.00, dailyRate: $9.00
   └── ... (12 months)

2. PERSIST PRIME PERIODS TO FIRESTORE (critical!)

3. GENERATE NON-PRIME PERIODS (weekly, bi-monthly)
   For each non-prime period:
   ├── Find overlapping primes
   ├── For each day: lookup prime's dailyRate
   └── Sum daily rates = allocatedAmount

   Example: Weekly Jan 26 - Feb 1
   ├── Jan 26-31: 6 days × $8.13 = $48.77
   ├── Feb 1: 1 day × $9.00 = $9.00
   └── Total: $57.77

4. PERSIST NON-PRIME PERIODS TO FIRESTORE
```

## Key Functions

### Prime Period Generation

**File:** `primePeriodGeneration.ts`

```typescript
// Determine prime type for a budget
const primeType = getPrimePeriodType(budget.period);
// WEEKLY → PeriodType.WEEKLY
// MONTHLY → PeriodType.MONTHLY
// BI_WEEKLY/BI_MONTHLY → PeriodType.BI_MONTHLY

// Get non-prime types
const nonPrimeTypes = getNonPrimePeriodTypes(budget.period);
// Returns all types EXCEPT the prime type

// Generate prime periods
const primePeriods = await generatePrimeBudgetPeriods(db, budgetId, budget, startDate, endDate);
```

### Non-Prime Period Generation

**File:** `nonPrimePeriodGeneration.ts`

```typescript
// Find primes that overlap with a date range
const overlappingPrimes = findOverlappingPrimePeriods(targetStart, targetEnd, sortedPrimePeriods);

// Calculate contributions using SUMPRODUCT algorithm
const { totalAmount, breakdown } = calculatePrimeContributions(targetStart, targetEnd, overlappingPrimes);

// Generate non-prime periods for a specific type
const nonPrimePeriods = await generateNonPrimeBudgetPeriods(
  db, budgetId, budget, primePeriods, startDate, endDate, PeriodType.WEEKLY
);
```

### Orchestrator

**File:** `periodGenerationOrchestrator.ts`

```typescript
// Main entry point - handles entire workflow
const result = await generateBudgetPeriodsWithPrimeSystem(db, budgetId, budget);

// Returns:
{
  budgetPeriods: BudgetPeriodDocument[],
  count: number,
  periodTypeCounts: { weekly, biMonthly, monthly },
  firstPeriodId: string,
  lastPeriodId: string
}
```

## Algorithm: SUMPRODUCT (Non-Prime Calculation)

```typescript
// For each day in the non-prime period:
let totalAmount = 0;
const currentDate = new Date(targetStart);

while (currentDate <= targetEnd) {
  // Find which prime period contains this day
  const prime = primesByDate.get(currentDate);

  if (prime) {
    // Add this day's allocation
    totalAmount += prime.dailyRate;
  }

  // Move to next day
  currentDate.setDate(currentDate.getDate() + 1);
}
```

## Migration Strategy

### Existing Documents

No migration required! Safe defaults:

```typescript
// Read existing budget periods
const isPrime = period.isPrime ?? true; // Treat existing as prime
const dailyRate = period.dailyRate ?? calculateDailyRate(period);
const primePeriodIds = period.primePeriodIds ?? [];
```

### New Budgets

Automatically use Prime/Non-Prime system when created.

### Optional: Backfill Existing Budgets

```typescript
// Future enhancement: Admin function to backfill
async function backfillPrimeNonPrimeFields(budgetId: string) {
  // 1. Query all budget_periods for this budget
  // 2. Determine prime type from parent budget
  // 3. Set isPrime, dailyRate, daysInPeriod
  // 4. For non-primes: calculate primePeriodIds and breakdown
}
```

## Testing

### Verify a Budget Period

```typescript
// Check prime period
const prime = await db.collection('budget_periods').doc('budget_123_2026-M01').get();
console.log('Prime period:', prime.data());
// Expected: isPrime=true, dailyRate=$8.13, daysInPeriod=15

// Check non-prime period
const nonPrime = await db.collection('budget_periods').doc('budget_123_2026-W05').get();
console.log('Non-prime period:', nonPrime.data());
// Expected: isPrime=false, primePeriodIds=['budget_123_2026-M01', 'budget_123_2026-M02']

// Check breakdown
nonPrime.data().primePeriodBreakdown.forEach(c => {
  console.log(`${c.sourcePeriodId}: ${c.daysContributed} days × $${c.dailyRate} = $${c.amountContributed}`);
});
```

### Test Cases

See `PRIME_NON_PRIME_SYSTEM.md` for detailed test cases:
- Monthly budget ($252/month starting Jan 17)
- Weekly budget ($25/week starting Jan 17)
- Bi-weekly budget ($25/bi-weekly starting Jan 17)

## Common Issues

### "No prime periods found in date range"

**Fix:** Generate source_periods for the required date range
```bash
firebase functions:call generateSourcePeriods --data '{"years": [2026, 2027]}'
```

### Non-prime amounts seem incorrect

**Debug:**
```typescript
console.log('Debugging non-prime:', periodId);
period.primePeriodBreakdown.forEach(c => {
  console.log(`  ${c.sourcePeriodId}: ${c.daysContributed} days × $${c.dailyRate} = $${c.amountContributed}`);
});
console.log('Total:', period.allocatedAmount);
```

### Primes not persisted before non-primes

**Critical Bug!** Orchestrator must follow strict sequence:
1. Generate primes (in-memory)
2. **Persist primes to Firestore** (await completion!)
3. Generate non-primes (using in-memory primes)
4. Persist non-primes to Firestore

## Logging

Look for these log messages:

```
[periodGenerationOrchestrator] === PHASE 1: GENERATING PRIME PERIODS ===
[primePeriodGeneration] Prime period 2026-M01: allocatedAmount: 121.94, dailyRate: 8.13

[periodGenerationOrchestrator] === PHASE 2: PERSISTING PRIME PERIODS ===
[budgetPeriods] Created batch 1/1 (13 periods)

[periodGenerationOrchestrator] === PHASE 3: GENERATING NON-PRIME PERIODS ===
[calculatePrimeContributions] totalAmount: 57.77, breakdownCount: 2

[periodGenerationOrchestrator] === PHASE 4: PERSISTING NON-PRIME PERIODS ===
[budgetPeriods] Created batch 1/2 (106 periods)

[periodGenerationOrchestrator] === GENERATION COMPLETE ===
```

## Files Reference

**Core Implementation:**
- `primePeriodGeneration.ts` - Prime period logic
- `nonPrimePeriodGeneration.ts` - Non-prime period logic
- `periodGenerationOrchestrator.ts` - Orchestration
- `budgetPeriods.ts` - Entry point (delegates to orchestrator)

**Types:**
- `/src/types/index.ts` - `PrimePeriodContribution`, `BudgetPeriodDocument` fields

**Documentation:**
- `/PRIME_NON_PRIME_SYSTEM.md` - Complete documentation
- This file - Quick reference

## Summary

✅ **No code changes required** for basic usage - `generateBudgetPeriodsForNewBudget` automatically delegates
✅ **Backward compatible** - all new fields are optional
✅ **Perfect alignment** across period views
✅ **Transparent calculations** via `primePeriodBreakdown`
✅ **Comprehensive logging** for debugging

**Key Takeaway:** Prime periods are authoritative; non-prime periods derive from primes using daily rate lookups.
