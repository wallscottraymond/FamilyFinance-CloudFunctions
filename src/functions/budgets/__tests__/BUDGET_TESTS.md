# Budget Period Testing Documentation

## Overview

This document describes the comprehensive test suite for the budget period system, including amount calculations, period generation, and validation requirements.

## Test File Structure

```
src/functions/budgets/__tests__/
├── BUDGET_TESTS.md                          # This documentation
├── helpers/
│   └── budgetTestHelpers.ts                 # Test utilities and helpers
├── amountCalculation/
│   ├── monthlyBudgetAmounts.unit.test.ts   # Monthly budget → other periods
│   ├── biMonthlyBudgetAmounts.unit.test.ts # Bi-monthly budget → other periods
│   └── weeklyBudgetAmounts.unit.test.ts    # Weekly budget → other periods
├── budgetCreation.unit.test.ts              # Budget document creation
├── periodGeneration.unit.test.ts            # Period generation from source
├── periodBoundaries.unit.test.ts            # Period boundary validation
├── amountValidation.unit.test.ts            # Sum validation (±$0.01)
└── userSummaryUpdates.integration.test.ts   # Summary trigger tests
```

## Naming Conventions

- `.unit.test.ts` - Unit tests with mocked dependencies
- `.integration.test.ts` - Integration tests requiring Firestore emulator

## Key Requirements

### 1. Period Types

The system uses three period types:

| Type | Format | Boundaries |
|------|--------|------------|
| **MONTHLY** | `2025-M01` | Day 1 - Last day of month |
| **BI_MONTHLY** | `2025-BM01-1`, `2025-BM01-2` | Days 1-15, Days 16-end |
| **WEEKLY** | `2025-W01` | Sunday - Saturday (US standard) |

### 2. Amount Calculation Rules

#### Daily Rate Calculation

- **Monthly Budget**: Daily rate = budget amount / days in that month
- **Bi-Monthly Budget**: Daily rate = budget amount / days in that bi-monthly period
- **Weekly Budget**: Daily rate = budget amount / 7 (always 7 days)

#### Cross-Month Handling

When a period spans multiple months (e.g., a week from Jan 26 - Feb 1):
- Calculate each day using that month's daily rate
- Sum the allocations for the complete period

**Example (Monthly Budget $100):**
```
Week: Jan 26 - Feb 1 (7 days)
- Jan 26-31: 6 days × ($100/31) = $19.35
- Feb 1: 1 day × ($100/28) = $3.57
- Total: $22.92
```

### 3. Critical Validation Rule

**Sum of all period types must be equal within tolerance (±$0.01 per period)**

For any budget range:
- Sum of monthly periods ≈ Sum of bi-monthly periods ≈ Sum of weekly periods
- Maximum difference should scale with number of periods
- Single month: ±$0.01 tolerance
- Full year: ±$0.20 tolerance

### 4. Bi-Monthly Boundaries

Bi-monthly periods always use:
- **First half**: Days 1-15 (15 days)
- **Second half**: Days 16-end (varies: 13-16 days)

| Month | Second Half Days |
|-------|------------------|
| January | 16 days |
| February | 13 days (14 leap year) |
| March | 16 days |
| April | 15 days |
| May | 16 days |
| June | 15 days |
| July | 16 days |
| August | 16 days |
| September | 15 days |
| October | 16 days |
| November | 15 days |
| December | 16 days |

## User Examples

### Example 1: Monthly Budget Feb 1 - March 19

```
Budget: $100/month
Date Range: Feb 1 - March 19

Daily Rates:
- February (28 days): $100/28 = $3.57/day
- March (31 days): $100/31 = $3.23/day

Weekly Periods:
- Feb 1-7: 7 × $3.57 = $24.99
- Feb 8-14: 7 × $3.57 = $24.99
- Feb 15-21: 7 × $3.57 = $24.99
- Feb 22-28: 7 × $3.57 = $24.99
- Mar 1-7: 7 × $3.23 = $22.61
- Mar 8-14: 7 × $3.23 = $22.61
- Mar 15-19: 5 × $3.23 = $16.15

Total: $161.33

Validation: All period sums should equal ~$161.33
```

### Example 2: Bi-Monthly Budget Feb 1 - April 13

```
Budget: $100/bi-monthly period
Date Range: Feb 1 - April 13

Bi-Monthly Periods:
- Feb 1-15: $100
- Feb 16-28: $100
- Mar 1-15: $100
- Mar 16-31: $100
- Apr 1-13: $100 × (13/15) = $86.67
Total: $486.67

Monthly Periods:
- February: $200
- March: $200
- April 1-13: $86.67
Total: $486.67

Weekly Periods:
(Complex calculation using daily rates)
Total: $486.67

Validation: All period type sums should equal ~$486.67
```

## Running Tests

### All Budget Tests
```bash
npm test -- --testPathPattern=budgets/__tests__
```

### Specific Test File
```bash
npm test -- --testPathPattern=monthlyBudgetAmounts
```

### Unit Tests Only
```bash
npm test -- --testPathPattern="\\.unit\\.test\\.ts$"
```

### Integration Tests Only
```bash
npm test -- --testPathPattern="\\.integration\\.test\\.ts$"
```

### With Coverage
```bash
npm test -- --coverage --testPathPattern=budgets/__tests__
```

## Test Helper Functions

Located in `helpers/budgetTestHelpers.ts`:

### Date Utilities
- `getDaysInMonth(year, month)` - Get days in a specific month
- `createTimestamp(year, month, day)` - Create Firestore Timestamp
- `getDaysBetween(start, end)` - Calculate days between timestamps

### Period Creation
- `createMockSourcePeriod(options)` - Create mock SourcePeriod
- `createMonthlySourcePeriods(startYear, startMonth, endYear, endMonth)`
- `createBiMonthlySourcePeriods(startYear, startMonth, endYear, endMonth)`
- `createWeeklySourcePeriods(startDate, endDate)`

### Amount Calculation
- `calculateExpectedAmount(budgetAmount, budgetPeriodType, targetPeriod)`
- `getMonthlyDailyRate(monthlyAmount, year, month)`
- `getBiMonthlyDailyRate(biMonthlyAmount, year, month, half)`

### Validation
- `roundToCents(value)` - Round to 2 decimal places
- `amountsEqual(a, b, tolerance)` - Check equality within tolerance
- `calculatePeriodTypeTotals(...)` - Calculate totals by period type
- `validatePeriodTotalsMatch(summaries, tolerance)` - Validate sums are equal

### Scenario Helpers
- `createExample1Scenario()` - User's Example 1 data
- `createExample2Scenario()` - User's Example 2 data
- `createLeapYearScenario()` - Leap year February data

## Edge Cases to Test

### Date Edge Cases
- Leap year February (29 days)
- Month boundaries (31-day vs 30-day vs 28-day months)
- Weeks spanning month boundaries
- Budget starting/ending mid-month
- Budget starting/ending mid-week

### Amount Edge Cases
- Zero budget amount
- Very large budget amounts ($1,000,000+)
- Decimal budget amounts ($99.99)
- Single day periods

### Period Edge Cases
- Partial week at budget end
- Partial bi-monthly at budget end
- Week crossing bi-monthly boundary (day 15/16)
- Week crossing month boundary

## Troubleshooting

### Test Failures Due to Rounding

If tests fail due to small differences:
1. Check tolerance value (use `amountsEqual(a, b, 0.01)`)
2. Ensure `roundToCents()` is used for comparisons
3. Scale tolerance for multi-period tests

### Timestamp Issues

Always use `createTimestamp(year, month, day)` helper to ensure:
- Consistent timezone handling
- UTC midnight timestamps
- Correct month indexing (helper uses 1-based months)

### Period ID Mismatches

Period IDs follow these formats:
- Monthly: `YYYY-MXX` (e.g., `2025-M01`)
- Bi-monthly: `YYYY-BMXX-H` (e.g., `2025-BM01-1`)
- Weekly: `YYYY-WXX` (e.g., `2025-W05`)

## Related Documentation

- `/src/functions/budgets/CLAUDE.md` - Budget system architecture
- `/src/functions/budgets/utils/calculatePeriodAllocatedAmount.ts` - Core calculation logic
- `/src/functions/budgets/utils/budgetPeriods.ts` - Period generation logic
- `/TESTING.md` - Project testing strategy
