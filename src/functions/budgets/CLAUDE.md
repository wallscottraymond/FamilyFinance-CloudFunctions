# Budget System - Cloud Functions

> **Full documentation:** `../../../../FamilyFinanceObsidian/Documentation/FamilyFinanceBackend/Budgets/`

## Key Documentation

| Topic | Obsidian Path |
|-------|---------------|
| Budget System | `Documentation/FamilyFinanceBackend/Budgets/System.md` |
| Prime/Non-Prime | `Documentation/FamilyFinanceBackend/Budgets/Prime-NonPrime.md` |
| Creation Flow | `Documentation/FamilyFinanceBackend/Budgets/Creation-Flow.md` |
| Checklist | `Documentation/FamilyFinanceBackend/Budgets/Checklist.md` |

## Quick Reference

### Core Concept
- **Budgets** = Blueprints (configuration, rarely changed)
- **Budget Periods** = Instances (user interacts with daily)

### Period Types
| Type | Prime Daily Rate | Example |
|------|-----------------|---------|
| MONTHLY | amount / days in month | $8.13/day for $252/31 days |
| BI_MONTHLY | amount / days in half | $1.79/day for $25/14 days |
| WEEKLY | amount / 7 | $3.57/day for $25/week |

### Day Counting (Critical)
```typescript
// UTC-normalized to avoid off-by-one errors
const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
const days = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24)) + 1;
```

### Precision
- Prime `dailyRate`: 6 decimal places
- Non-prime `dailyRate`: 2 decimal places

## Rollover System

Budget periods support rollover - carrying surplus/deficit between periods.

### Key Files
| File | Purpose |
|------|---------|
| `utils/rolloverCalculation.ts` | Core rollover logic |
| `utils/rolloverChainCalculation.ts` | Chain recalculation |
| `orchestration/scheduled/calculateDailyRollover.ts` | Daily scheduled function |

### Rollover Rules
- **Same type only**: Weekly → Weekly, Monthly → Monthly
- **Surplus (underspend)**: Positive rollover added to next period
- **Deficit (overspend)**: Negative rollover (immediate or spread)
- **Spread**: Max 6 periods, equal distribution

### Calculation Formula
```typescript
effectiveAmount = allocatedAmount + rolledOverAmount
remaining = effectiveAmount - spent
// Can be negative if deficit exceeds allocation
```

### Triggers
1. **Spending changes**: `onBudgetPeriodUpdated` recalculates chain
2. **Daily scheduled**: `calculateDailyRollover` at 3 AM UTC

### Settings Priority
1. Per-budget settings (`budget.rolloverEnabled`, etc.)
2. User global settings (`user.financialSettings.budgetRolloverEnabled`)
3. Defaults (enabled, spread, 3 periods)

## RBAC Migration Status
- [x] Budget interface updated
- [x] BudgetPeriodDocument updated
- [ ] Security rules update
- [ ] Permission validation in functions

See `Architecture/RBAC-System.md` for details.
