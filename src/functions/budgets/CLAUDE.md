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

## RBAC Migration Status
- [x] Budget interface updated
- [x] BudgetPeriodDocument updated
- [ ] Security rules update
- [ ] Permission validation in functions

See `Architecture/RBAC-System.md` for details.
