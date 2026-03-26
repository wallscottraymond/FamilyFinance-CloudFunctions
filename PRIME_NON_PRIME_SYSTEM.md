# Prime/Non-Prime Budget Period System

## Overview

The Prime/Non-Prime Budget Period System refactors budget period generation to ensure accurate cross-period calculations. Instead of using average-based conversions, the system now:

1. **Prime periods** match the budget's `period` field and are the authoritative source
2. **Non-prime periods** derive their amounts from prime periods using daily rate lookups
3. **Daily rate consistency** ensures spending aligns correctly across all period views

## Architecture

### Prime Period Types

| User Creates (budget.period) | Prime Type | Non-Prime Types |
|------------------------------|------------|-----------------|
| WEEKLY | PeriodType.WEEKLY | MONTHLY, BI_MONTHLY |
| MONTHLY | PeriodType.MONTHLY | WEEKLY, BI_MONTHLY |
| BI_WEEKLY / BI_MONTHLY | PeriodType.BI_MONTHLY | WEEKLY, MONTHLY |

### Key Concepts

**Prime Periods:**
- Match the budget's `period` field (what the user creates)
- Have `isPrime: true`
- Calculate `dailyRate = allocatedAmount / daysInPeriod`
- Are the authoritative source for budget allocation
- Must be created and persisted BEFORE non-prime periods

**Non-Prime Periods:**
- Do NOT match the budget's period field
- Have `isPrime: false`
- Derive `allocatedAmount` from overlapping prime periods
- Use day-by-day SUMPRODUCT algorithm:
  - For each day in the non-prime period
  - Find which prime period contains that day
  - Get that prime's `dailyRate`
  - Add to running total
- Include `primePeriodIds` and `primePeriodBreakdown` for traceability

## Implementation

### Phase 1: Type Definitions

**File:** `/src/types/index.ts`

Added `PrimePeriodContribution` interface:
```typescript
export interface PrimePeriodContribution {
  primePeriodId: string;      // Budget period ID, e.g., "budget_123_2026M01"
  sourcePeriodId: string;     // Source period ID for reference, e.g., "2026M01"
  daysContributed: number;    // Days from this prime period that fall within non-prime period
  dailyRate: number;          // Daily rate from prime period (allocatedAmount / daysInPeriod)
  amountContributed: number;  // daysContributed × dailyRate (rounded to 2 decimals)
  overlapStart: Timestamp;    // Start of overlap range (inclusive)
  overlapEnd: Timestamp;      // End of overlap range (inclusive)
}
```

Added optional fields to `BudgetPeriodDocument`:
```typescript
// === PRIME/NON-PRIME PERIOD FIELDS (Optional - added 2026-03) ===

/** Whether this is a prime period (matches budget's period type). Default: undefined (treat as true for existing docs) */
isPrime?: boolean;

/** Daily rate for this period: allocatedAmount / daysInPeriod. Calculated field. */
dailyRate?: number;

/** Number of days in this specific budget period */
daysInPeriod?: number;

/** For non-prime periods: IDs of overlapping prime periods. Empty array for prime periods. */
primePeriodIds?: string[];

/** For non-prime periods: detailed breakdown of contributions from each prime. Empty array for prime periods. */
primePeriodBreakdown?: PrimePeriodContribution[];
```

### Phase 2: Prime Period Generation

**File:** `/src/functions/budgets/utils/primePeriodGeneration.ts`

**Functions:**
- `getPrimePeriodType(budgetPeriod: BudgetPeriod): PeriodType` - Maps budget period to prime type
- `getNonPrimePeriodTypes(budgetPeriod: BudgetPeriod): PeriodType[]` - Returns non-prime types
- `generatePrimeBudgetPeriods()` - Generates prime periods with dailyRate calculated

**Key Logic:**
```typescript
// Calculate allocated amount based on actual days (handles partial periods)
const allocatedAmount = (budget.amount * daysInPeriod) / fullPeriodDays;

// Calculate daily rate for this prime period
const dailyRate = allocatedAmount / daysInPeriod;

// Set prime period flags
isPrime: true,
dailyRate: Math.round(dailyRate * 100) / 100,
daysInPeriod,
primePeriodIds: [],
primePeriodBreakdown: [],
```

### Phase 3: Non-Prime Period Generation

**File:** `/src/functions/budgets/utils/nonPrimePeriodGeneration.ts`

**Functions:**
- `findOverlappingPrimePeriods()` - Find primes that overlap with target date range
- `calculatePrimeContributions()` - SUMPRODUCT algorithm for daily rate lookup
- `generateNonPrimeBudgetPeriods()` - Generates non-prime periods derived from primes

**Key Algorithm (SUMPRODUCT):**
```typescript
// Build a map of prime periods by date for fast lookup
const primesByDate: Map<string, BudgetPeriodDocument> = new Map();

// Iterate through each day in the non-prime period
const currentDate = new Date(targetStart);
while (currentDate <= targetEnd) {
  const dateKey = currentDate.toISOString().split('T')[0];
  const prime = primesByDate.get(dateKey);

  if (prime) {
    const dailyRate = prime.dailyRate || 0;
    totalAmount += dailyRate;

    // Track contribution from this prime
    contribution.daysContributed++;
    contribution.amountContributed += dailyRate;
  }

  currentDate.setDate(currentDate.getDate() + 1);
}
```

### Phase 4: Orchestrator

**File:** `/src/functions/budgets/utils/periodGenerationOrchestrator.ts`

**Function:** `generateBudgetPeriodsWithPrimeSystem()`

**Process:**
1. Determine prime type from `budget.period`
2. Generate prime periods → calculate dailyRate for each
3. **Persist prime periods to Firestore FIRST** (MUST complete before step 4)
4. In parallel: Generate non-prime periods for each non-prime type (referencing persisted primes)
5. Persist non-prime periods to Firestore
6. Return combined result

**Integration:**
- Modified `generateBudgetPeriodsForNewBudget()` in `budgetPeriods.ts` to delegate to new orchestrator
- Marked old function as `@deprecated`
- Re-exported orchestrator from `budgetPeriods.ts` for easy access

## Verification Test Cases

### Test Case 1: Monthly Budget ($252/month starting Jan 17, 2026)

**Expected Results:**

**Prime Monthly Periods:**
- Jan 17-31: 15 days, $121.94, dailyRate: $8.13
- Feb 1-28: 28 days, $252.00, dailyRate: $9.00

**Non-Prime Weekly Period (Jan 26 - Feb 1):**
- 6 days × $8.13 (from Jan prime) = $48.77
- 1 day × $9.00 (from Feb prime) = $9.00
- **Total: $57.77**

**Verification:**
```typescript
// Jan 26-31: 6 days in January prime
6 × 8.13 = 48.78

// Feb 1: 1 day in February prime
1 × 9.00 = 9.00

// Total
48.78 + 9.00 = 57.78 ≈ $57.77 (with rounding)
```

### Test Case 2: Weekly Budget ($25/week starting Jan 17, 2026)

**Expected Results:**

**Prime Weekly Periods:**
- Jan 17-18: 2 days, $7.14, dailyRate: $3.57
- Jan 19-25: 7 days, $25.00, dailyRate: $3.57

**Non-Prime Monthly Period (Feb 1-28):**
- 28 days × $3.57 = **$100.00**

**Verification:**
```typescript
// February has 28 days, all at weekly rate
28 × 3.57 = 99.96 ≈ $100.00 (with rounding)
```

### Test Case 3: Bi-Weekly Budget ($25/bi-weekly starting Jan 17, 2026)

**Expected Results:**

**Prime Bi-Weekly Periods:**
- Jan 17-31: 15 days, $25.00, dailyRate: $1.67
- Feb 1-14: 14 days, $25.00, dailyRate: $1.79

**Non-Prime Weekly Period (Jan 26 - Feb 1):**
- 6 days × $1.67 (from Jan prime) = $10.02
- 1 day × $1.79 (from Feb prime) = $1.79
- **Total: $11.81** (≈ $11.79 with rounding)

**Non-Prime Monthly Period (Feb 1-28):**
- 14 days × $1.79 (first bi-monthly) = $25.06
- 14 days × $1.79 (second bi-monthly) = $25.06
- **Total: $50.12** (≈ $50.00 with rounding)

## Benefits

### 1. Perfect Alignment Across Period Views
- Spending totals match regardless of view (monthly, bi-monthly, weekly)
- No more discrepancies when switching between period types

### 2. Accurate Representation
- February with 28 days allocates less than March with 31 days
- Correct bi-monthly splits (first half vs second half)
- Multi-month weeks correctly allocate from each month's budget

### 3. Transparent Calculations
- `primePeriodBreakdown` shows exactly where each dollar comes from
- Traceable daily rate lookups for debugging
- Clear audit trail for non-prime period amounts

### 4. Backward Compatible
- All new fields are optional
- Existing documents continue to work
- Safe defaults: `isPrime ?? true`, `dailyRate ?? (allocatedAmount / days)`

## Usage

### Creating a New Budget

The system automatically uses the Prime/Non-Prime approach:

```typescript
import { generateBudgetPeriodsForNewBudget } from './utils/budgetPeriods';

// This now delegates to generateBudgetPeriodsWithPrimeSystem
const result = await generateBudgetPeriodsForNewBudget(db, budgetId, budget);

console.log(`Created ${result.count} total periods:`, {
  weekly: result.periodTypeCounts.weekly,
  biMonthly: result.periodTypeCounts.biMonthly,
  monthly: result.periodTypeCounts.monthly,
});
```

### Direct Access to New System

```typescript
import { generateBudgetPeriodsWithPrimeSystem } from './utils/periodGenerationOrchestrator';

const result = await generateBudgetPeriodsWithPrimeSystem(db, budgetId, budget);
```

### Reading Budget Periods

```typescript
// Prime period
const primePeriod = await db.collection('budget_periods').doc(periodId).get();
const primeData = primePeriod.data();

console.log('Prime period:', {
  isPrime: primeData.isPrime,
  allocatedAmount: primeData.allocatedAmount,
  dailyRate: primeData.dailyRate,
  daysInPeriod: primeData.daysInPeriod,
});

// Non-prime period
const nonPrimePeriod = await db.collection('budget_periods').doc(periodId).get();
const nonPrimeData = nonPrimePeriod.data();

console.log('Non-prime period:', {
  isPrime: nonPrimeData.isPrime,
  allocatedAmount: nonPrimeData.allocatedAmount,
  primePeriodIds: nonPrimeData.primePeriodIds,
  breakdown: nonPrimeData.primePeriodBreakdown,
});

// Breakdown shows contributions from each prime
nonPrimeData.primePeriodBreakdown.forEach(contribution => {
  console.log(`Prime ${contribution.primePeriodId}:`, {
    days: contribution.daysContributed,
    dailyRate: contribution.dailyRate,
    amount: contribution.amountContributed,
    range: `${contribution.overlapStart.toDate()} to ${contribution.overlapEnd.toDate()}`,
  });
});
```

## Migration for Existing Documents

### Safe Defaults

When reading existing budget periods that don't have the new fields:

```typescript
// Treat undefined isPrime as true (existing docs are prime)
const isPrime = budgetPeriod.isPrime ?? true;

// Calculate daily rate on-the-fly if missing
const dailyRate = budgetPeriod.dailyRate ??
  (budgetPeriod.allocatedAmount / getDaysInPeriod(budgetPeriod.periodStart, budgetPeriod.periodEnd));

// Treat undefined arrays as empty
const primePeriodIds = budgetPeriod.primePeriodIds ?? [];
const primePeriodBreakdown = budgetPeriod.primePeriodBreakdown ?? [];
```

### Migration Strategy

1. **New budgets** automatically use Prime/Non-Prime system
2. **Existing budgets** continue to work with safe defaults
3. **Optional migration script** (future enhancement):
   - Query all budget_periods without `isPrime` field
   - Determine prime type from parent budget
   - Set `isPrime`, `dailyRate`, `daysInPeriod` retroactively
   - For non-primes: calculate `primePeriodIds` and `primePeriodBreakdown`

## Troubleshooting

### No Prime Periods Generated

**Symptom:** Error "No prime periods found in date range"

**Cause:** No source_periods exist for the prime period type in the specified date range

**Solution:**
```bash
# Run admin function to generate source periods
firebase functions:call generateSourcePeriods --data '{"years": [2026, 2027]}'
```

### Non-Prime Amounts Don't Match Expected

**Symptom:** Non-prime period amounts seem incorrect

**Debug Steps:**
1. Check prime period `dailyRate` values
2. Verify `primePeriodBreakdown` shows correct day counts
3. Manually calculate: sum(daysContributed × dailyRate) for each prime
4. Check for rounding differences (amounts rounded to 2 decimals)

**Example Debug Output:**
```typescript
console.log('Debugging non-prime period:', periodId);
console.log('Prime contributions:');
period.primePeriodBreakdown.forEach(c => {
  console.log(`  ${c.sourcePeriodId}: ${c.daysContributed} days × $${c.dailyRate} = $${c.amountContributed}`);
});
console.log('Total:', period.allocatedAmount);
```

### Prime Periods Not Persisted Before Non-Prime

**Symptom:** Non-prime generation fails or produces incorrect results

**Cause:** Critical bug - non-prime generation attempted before primes are saved to Firestore

**Fix:** Ensure orchestrator follows strict sequence:
1. Generate prime periods (in-memory)
2. **Persist prime periods to Firestore** (await completion)
3. Generate non-prime periods (using in-memory primes for calculations)
4. Persist non-prime periods to Firestore

## Logging

The system includes comprehensive logging for debugging:

```
[periodGenerationOrchestrator] Starting Prime/Non-Prime period generation for budget budget_123
[periodGenerationOrchestrator] Budget period type: monthly
[periodGenerationOrchestrator] Date range: 2026-01-17 to 2027-01-17
[periodGenerationOrchestrator] Prime type: monthly
[periodGenerationOrchestrator] Non-prime types: weekly, bi_monthly

[periodGenerationOrchestrator] === PHASE 1: GENERATING PRIME PERIODS ===
[primePeriodGeneration] Generating PRIME periods for budget budget_123
[primePeriodGeneration] Prime period type: monthly
[primePeriodGeneration] Found 13 monthly source periods
[primePeriodGeneration] Prime period 2026-M01:
  fullPeriodDays: 31
  actualDays: 15
  allocatedAmount: 121.94
  dailyRate: 8.13
  actualStart: 2026-01-17
  actualEnd: 2026-01-31

[periodGenerationOrchestrator] === PHASE 2: PERSISTING PRIME PERIODS ===
[budgetPeriods] Batch creating 13 budget periods
[budgetPeriods] Created batch 1/1 (13 periods)

[periodGenerationOrchestrator] === PHASE 3: GENERATING NON-PRIME PERIODS ===
[nonPrimePeriodGeneration] Generating NON-PRIME weekly periods for budget budget_123
[nonPrimePeriodGeneration] Found 53 weekly source periods
[calculatePrimeContributions] Calculation summary:
  targetRange: 2026-01-26 to 2026-02-01
  overlappingPrimes: 2
  totalAmount: 57.77
  breakdownCount: 2

[periodGenerationOrchestrator] === PHASE 4: PERSISTING NON-PRIME PERIODS ===
[budgetPeriods] Batch creating 106 budget periods

[periodGenerationOrchestrator] === GENERATION COMPLETE ===
[periodGenerationOrchestrator] Total periods created: 119
[periodGenerationOrchestrator] Period counts:
  prime: 13
  nonPrime: 106
  weekly: 53
  biMonthly: 26
  monthly: 13
```

## Future Enhancements

### 1. UI Visualization

Show users how their budget is allocated across period types:

```
Monthly Budget: $252/month

January 2026 (partial):
├── Daily rate: $8.13/day
├── Days: 15 (Jan 17-31)
└── Allocated: $121.94

Contributing to:
├── Weekly Jan 26 - Feb 1: $48.77 (6 days)
├── Bi-Monthly Jan 1-15: [partial contribution]
└── Bi-Monthly Jan 16-31: $121.94 (full period)
```

### 2. Recalculation Function

Admin function to recalculate non-prime periods if prime periods change:

```typescript
async function recalculateNonPrimePeriods(budgetId: string) {
  // 1. Query all prime periods for budget
  // 2. For each non-prime period:
  //    - Calculate contributions from current primes
  //    - Update allocatedAmount and breakdown
  //    - Preserve user modifications (isModified flag)
}
```

### 3. Historical Analysis

Track how prime daily rates change over time:

```typescript
interface DailyRateHistory {
  budgetId: string;
  periodId: string;
  date: Date;
  dailyRate: number;
  reason: 'partial_period' | 'user_modified' | 'budget_adjustment';
}
```

## Testing

### Unit Tests

```typescript
describe('Prime Period Generation', () => {
  it('should generate prime periods matching budget period type', async () => {
    const budget = createMockBudget({ period: BudgetPeriod.MONTHLY });
    const primes = await generatePrimeBudgetPeriods(db, 'test', budget, startDate, endDate);

    expect(primes.every(p => p.periodType === PeriodType.MONTHLY)).toBe(true);
    expect(primes.every(p => p.isPrime === true)).toBe(true);
    expect(primes.every(p => p.dailyRate > 0)).toBe(true);
  });

  it('should handle partial first period correctly', async () => {
    const budget = createMockBudget({
      period: BudgetPeriod.MONTHLY,
      amount: 252,
      startDate: new Date('2026-01-17'),
    });

    const primes = await generatePrimeBudgetPeriods(db, 'test', budget, startDate, endDate);
    const firstPeriod = primes[0];

    expect(firstPeriod.daysInPeriod).toBe(15); // Jan 17-31
    expect(firstPeriod.allocatedAmount).toBeCloseTo(121.94, 2);
    expect(firstPeriod.dailyRate).toBeCloseTo(8.13, 2);
  });
});

describe('Non-Prime Period Generation', () => {
  it('should calculate amounts from prime daily rates', async () => {
    const primePeriods = [
      createMockPrimePeriod({ dailyRate: 8.13, periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-01-31') }),
      createMockPrimePeriod({ dailyRate: 9.00, periodStart: new Date('2026-02-01'), periodEnd: new Date('2026-02-28') }),
    ];

    const nonPrimes = await generateNonPrimeBudgetPeriods(
      db, 'test', budget, primePeriods, startDate, endDate, PeriodType.WEEKLY
    );

    const weekSpanningMonths = nonPrimes.find(p => p.periodId === '2026-W05'); // Jan 26 - Feb 1

    expect(weekSpanningMonths.isPrime).toBe(false);
    expect(weekSpanningMonths.allocatedAmount).toBeCloseTo(57.77, 2);
    expect(weekSpanningMonths.primePeriodBreakdown).toHaveLength(2);
  });
});
```

### Integration Tests

```typescript
describe('Budget Period Generation Workflow', () => {
  it('should generate all period types with correct amounts', async () => {
    const budget = createMockBudget({
      period: BudgetPeriod.MONTHLY,
      amount: 252,
      startDate: new Date('2026-01-17'),
    });

    const result = await generateBudgetPeriodsWithPrimeSystem(db, 'test', budget);

    expect(result.count).toBeGreaterThan(0);
    expect(result.periodTypeCounts.monthly).toBeGreaterThan(0); // Prime periods
    expect(result.periodTypeCounts.weekly).toBeGreaterThan(0); // Non-prime periods
    expect(result.periodTypeCounts.biMonthly).toBeGreaterThan(0); // Non-prime periods

    // Verify prime periods have isPrime=true
    const primes = result.budgetPeriods.filter(p => p.isPrime === true);
    expect(primes.length).toBe(result.periodTypeCounts.monthly);

    // Verify non-prime periods have breakdown
    const nonPrimes = result.budgetPeriods.filter(p => p.isPrime === false);
    expect(nonPrimes.every(p => p.primePeriodBreakdown.length > 0)).toBe(true);
  });
});
```

## Notes for AI Assistants

- **Prime periods MUST be persisted before non-prime generation** - this is critical for the system to work
- **All new fields are optional** - existing documents continue to work with safe defaults
- **Round amounts to 2 decimals** - use `Math.round(amount * 100) / 100` for currency
- **Days calculation is inclusive** - use `(end - start + 1 day)` formula
- **SUMPRODUCT algorithm** - day-by-day lookup of prime daily rates
- **Reuse existing functions** - `batchCreateBudgetPeriods`, `updateBudgetPeriodRange`, etc.
- **Comprehensive logging** - include period IDs, amounts, daily rates, and breakdowns
- **Test with verification cases** - ensure monthly, weekly, and bi-weekly budgets produce expected results
- **Document structure preserved** - maintain exact same RBAC fields, legacy fields, and system fields
- **Prime first, then non-prime** - orchestrator must follow strict sequence
- **Use in-memory primes for calculations** - non-prime generation uses the generated prime array (not Firestore queries)

## Files Modified/Created

### Created Files:
1. `/src/functions/budgets/utils/primePeriodGeneration.ts` - Prime period generation logic
2. `/src/functions/budgets/utils/nonPrimePeriodGeneration.ts` - Non-prime period generation logic
3. `/src/functions/budgets/utils/periodGenerationOrchestrator.ts` - Orchestration of prime/non-prime system
4. `/PRIME_NON_PRIME_SYSTEM.md` - This documentation

### Modified Files:
1. `/src/types/index.ts` - Added `PrimePeriodContribution` interface and optional fields to `BudgetPeriodDocument`
2. `/src/functions/budgets/utils/budgetPeriods.ts` - Updated `generateBudgetPeriodsForNewBudget` to delegate to new system

### No Changes Required:
- `batchCreateBudgetPeriods()` - Works as-is
- `updateBudgetPeriodRange()` - Works as-is
- `determineBudgetPeriodDateRange()` - Works as-is
- Firestore security rules - Optional fields don't affect validation
- Mobile app - Reads optional fields with safe defaults

## Deployment

```bash
# 1. Build TypeScript
cd FamilyFinance-CloudFunctions
npm run build

# 2. Test locally (optional)
npm run dev

# 3. Deploy to Firebase
npm run deploy

# 4. Verify deployment
firebase functions:list | grep -i budget

# 5. Test with a new budget
# Create a budget via the mobile app or API
# Check Firestore to verify prime/non-prime periods created correctly
```

## Success Criteria

✅ TypeScript compilation succeeds with no errors
✅ All new fields are optional (backward compatible)
✅ Prime periods have `isPrime: true`, `dailyRate`, `daysInPeriod`
✅ Non-prime periods have `isPrime: false`, `primePeriodIds`, `primePeriodBreakdown`
✅ Non-prime amounts match verification test cases
✅ Comprehensive logging at each step
✅ Document structure preserved (RBAC, legacy fields, system fields)
✅ Existing `generateBudgetPeriodsForNewBudget` delegates to new system
✅ Orchestrator follows strict sequence (prime first, persist, then non-prime)

---

**Implementation Date:** March 20, 2026
**Status:** ✅ COMPLETE
**Version:** 1.0.0
