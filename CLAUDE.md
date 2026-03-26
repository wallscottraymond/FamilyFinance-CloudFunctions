# FamilyFinance Cloud Functions

> **Firebase Cloud Functions Backend** - Node.js 20, TypeScript, Firestore

## Quick Reference

### Commands
```bash
npm run build      # Build TypeScript
npm run deploy     # Deploy all functions
firebase deploy --only functions:functionName
firebase functions:log
```

### Function Types
```typescript
// Callable (user-initiated)
import { onCall } from 'firebase-functions/v2/https';

// Trigger (database events)
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

// Scheduled (cron)
import { onSchedule } from 'firebase-functions/v2/scheduler';
```

## Critical Rules

### ALWAYS
- Use Firebase Modular SDK (NOT namespaced)
- Use UTC-normalized day counting for dates
- Use `userId` for queries (NOT deprecated `accessibleBy`)
- Encrypt sensitive data (Plaid tokens use AES-256-GCM)
- Use batch writes (max 500 docs per batch)
- Log operations for debugging

### NEVER
- Store unencrypted tokens or secrets
- Use `any` types without justification
- Skip error handling in triggers
- Modify prime periods after non-prime periods reference them

### Field Naming
- `currentBalance` (NOT `balance`) for account balances
- `groupIds: string[]` for access control (NOT singular `groupId`)
- Period IDs: `2025M03`, `2025BM03A`, `2025W12` (no dashes)

## Domain Areas

| Domain | Path | Purpose |
|--------|------|---------|
| [Budgets](src/functions/budgets/CLAUDE.md) | `src/functions/budgets/` | Budget & period management |
| [Transactions](src/functions/transactions/CLAUDE.md) | `src/functions/transactions/` | Transaction processing |
| [Plaid](src/functions/plaid/CLAUDE.md) | `src/functions/plaid/` | Bank integration |
| [Outflows](src/functions/outflows/CLAUDE.md) | `src/functions/outflows/` | Recurring bills |
| [Inflows](src/functions/inflows/CLAUDE.md) | `src/functions/inflows/` | Recurring income |

## RBAC Pattern

```typescript
// All documents use groupIds for access control
const document = {
  userId: string,           // Owner
  groupIds: string[],       // [] = private, ['group1'] = shared
  isActive: boolean,
  createdAt: Timestamp,

  access: {
    ownerId: string,
    createdBy: string,
    groupIds: string[],     // Duplicate for validation
    isPrivate: boolean,
  },
};
```

## Day Counting (Critical)

```typescript
// UTC-normalized to avoid off-by-one errors
const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
const days = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24)) + 1;
```

## Error Handling Pattern

```typescript
export const myFunction = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated');
  }

  try {
    // Function logic
    return { success: true, data };
  } catch (error) {
    console.error('Function failed:', error);
    throw new HttpsError('internal', 'Operation failed');
  }
});
```

## See Also

- [Root CLAUDE.md](../CLAUDE.md) - Project-wide rules
- [Obsidian Docs](../FamilyFinanceObsidian/Documentation/FamilyFinanceBackend/_MOC.md) - Human documentation
