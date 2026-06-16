# FamilyFinance Cloud Functions

> **Firebase Cloud Functions Backend** - Node.js 20, TypeScript, Firestore

## Architecture Guide

> **IMPORTANT:** Before implementing ANY new function, read the [Layered Architecture Guide](src/functions/architecture/CLAUDE.md).

The architecture guide defines:
- The 5-layer structure (Entry → Orchestrator → Resolver → Domain → Repository)
- Templates for each layer
- Type definitions
- Edge case handling
- Testing requirements
- Complete checklist

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

## Testing & Firestore Access

> ⚠️ **`dev` and `default` are the SAME project** (`family-budget-app-cb59b`, see
> `.firebaserc`) — there is no separate dev database, and it has deployed
> triggers. Treat the live DB as production.

### Reading live Firestore (READ-ONLY)

To verify real state (e.g. after driving the app), use the read-only inspector.
It only reads (`get`/`where`/`limit`/`orderBy`/`select`/`count`) — no write path.

```bash
node scripts/inspect-firestore.js <collection> [--id <docId>] \
  [--where field=value]... [--limit N] [--order field[:desc]] [--select f1,f2] [--count] [--json]

# examples
node scripts/inspect-firestore.js accounts --where userId=<uid> --limit 10
node scripts/inspect-firestore.js transactions --where accountId=<acct> --where isHidden=true --count
node scripts/inspect-firestore.js plaid_items --id <docId>
```

Credentials: service-account key at `~/google-service-account-key.json` (or
`GOOGLE_APPLICATION_CREDENTIALS`). **Never commit keys** — they are gitignored.

### Integration tests (WRITE — emulator ONLY)

Anything that writes/mutates/deletes MUST run on the Firestore emulator, never
the live project (writes there fire real triggers and corrupt live data).

```bash
# unit (pure domain logic, no emulator)
npm test                      # jest --selectProjects unit

# emulator integration (cascade, restore, etc.)
firebase emulators:exec --only firestore "npm run test:emulator"
firebase emulators:exec --only firestore \
  "npx jest --selectProjects emulator --testPathPattern <name>"
```

Seed coherent graphs with the factory instead of hand-seeding:
`__emulator_tests__/helpers/seedAccountGraph.ts` →
`seedAccountGraph(db, { accounts, txnsPerAccount, outflows, inflows })`.

If real *write*-path integration testing is ever needed, stand up a SEPARATE dev
Firebase project first.

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
