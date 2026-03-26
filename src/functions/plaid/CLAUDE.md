# Plaid Integration - Cloud Functions

> **Bank Account Connectivity** - Real-time transactions, account balances, recurring detection

## Overview

Plaid integration enables:
- Bank account linking via Plaid Link
- Automatic transaction import and sync
- Recurring transaction detection (inflows/outflows)
- Real-time balance updates via webhooks

## Module Structure

```
plaid/
├── admin/          # Admin utilities (token management)
├── api/            # Public API endpoints
│   └── sync/       # Transaction sync functions
├── config/         # Plaid configuration
├── orchestration/  # Triggers and workflows
│   └── triggers/   # Firestore triggers
├── types/          # TypeScript interfaces
└── utils/          # Plaid utilities
```

## Critical Rules

### ALWAYS
- Encrypt access tokens using AES-256-GCM before storage
- Verify webhook signatures using HMAC-SHA256
- Use `currentBalance` field (NOT `balance`)
- Store positive amounts for inflows (Math.abs Plaid negatives)
- Log all Plaid API calls for debugging

### NEVER
- Store unencrypted access tokens
- Trust webhook data without signature verification
- Expose Plaid secrets in logs or errors

## Token Encryption

```typescript
import { encryptAccessToken, decryptAccessToken } from '../../utils/encryption';

// Encrypting before storage
const encrypted = encryptAccessToken(plaidAccessToken);
await db.collection('plaid_items').doc(itemId).set({
  accessToken: encrypted,  // AES-256-GCM encrypted
  // ...
});

// Decrypting for API calls
const item = await db.collection('plaid_items').doc(itemId).get();
const accessToken = decryptAccessToken(item.data().accessToken);
```

## Collections

| Collection | Purpose |
|------------|---------|
| `plaid_items` | Plaid connection metadata (encrypted tokens) |
| `accounts` | Connected bank accounts |
| `transactions` | Synced transactions |
| `plaid_webhooks` | Webhook event tracking |

## Account Balance Field

**CRITICAL:** Always use `currentBalance`, not `balance`:

```typescript
// In savePlaidAccounts (utils/plaidAccounts.ts)
const accountDoc = {
  currentBalance: account.balances.current,  // ✅ CORRECT
  availableBalance: account.balances.available,
  // balance: ...  // ❌ WRONG - deprecated field
};
```

## Webhook Processing

```typescript
// Verify signature before processing
const isValid = verifyWebhookSignature(
  request.rawBody,
  request.headers['plaid-verification'],
  PLAID_WEBHOOK_SECRET
);

if (!isValid) {
  throw new HttpsError('permission-denied', 'Invalid webhook signature');
}
```

## Transaction Sync Flow

```
Webhook: SYNC_UPDATES_AVAILABLE
    ↓
Verify signature
    ↓
Fetch Plaid item (decrypt token)
    ↓
Call Plaid /transactions/sync
    ↓
Map categories (mapPlaidCategoryToTransactionCategory)
    ↓
Save to transactions collection
    ↓
Update sync cursor
```

## Category Mapping

```typescript
// Primary category mappings
const categoryMap = {
  'food and drink': FOOD,
  'restaurants': FOOD,
  'groceries': FOOD,
  'transportation': TRANSPORTATION,
  'gas stations': TRANSPORTATION,
  'utilities': UTILITIES,
  'housing': HOUSING,
  'rent': HOUSING,
  'payroll': SALARY,
  // Default: OTHER_EXPENSE
};
```

## Recurring Detection

Plaid detects recurring patterns and reports them via:
- `/transactions/recurring/get` API
- Automatically processed into `inflows` and `outflows` collections

See:
- [Inflows CLAUDE.md](../inflows/CLAUDE.md) - Recurring income
- [Outflows CLAUDE.md](../outflows/CLAUDE.md) - Recurring bills

## Environment Variables

```
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_WEBHOOK_SECRET=...
TOKEN_ENCRYPTION_KEY=...  # 64-char hex for AES-256
```

## Testing

```bash
# Test in sandbox environment
firebase emulators:start

# Check webhook logs
firebase functions:log --only plaidWebhook
```

## See Also

- [Backend CLAUDE.md](../../CLAUDE.md) - Backend-wide rules
- [Root CLAUDE.md](../../../../CLAUDE.md) - Full Plaid documentation
