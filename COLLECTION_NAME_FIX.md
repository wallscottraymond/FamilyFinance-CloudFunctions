# Collection Name Mismatch Fix - Transaction Sync

## Issue

Transactions were not being created when adding a new Plaid account because of a **collection name mismatch**.

### The Problem

When the `onPlaidItemCreated` trigger runs, it executes three steps:

1. **Sync Balances** → Saves accounts to `accounts` collection ✅
2. **Sync Transactions** → Queries `plaid_accounts` collection ❌ (wrong collection!)
3. **Sync Recurring Transactions** → Works fine ✅

The transaction sync was looking for accounts in the wrong collection, so it couldn't find any accounts and skipped creating all transactions.

### Logs Showing the Issue

```
Looking for 1 unique accounts
Found 0 accounts
Account not found for transaction: XM5ep7b99eTly6RmabeVuDd636wLqAFbA8WmD
Account not found for transaction: DW5LKbnvvLC5yp3PoEkXI43vAvlXj1u3qGP5d
... [20 transactions skipped]
✅ Created 0 Family Finance transactions with splits from 20 Plaid transactions
```

## Root Cause

**Inconsistent collection naming:**
- `plaidAccounts.ts` saves accounts to: **`accounts`** collection
- `syncPlaidTransactions.ts` queries: **`plaid_accounts`** collection

This mismatch caused the query to return 0 results.

## Solution

Changed the collection name in `syncPlaidTransactions.ts:388` from `plaid_accounts` to `accounts`:

```typescript
// BEFORE (incorrect)
const accountQuery = await queryDocuments('plaid_accounts', {
  where: [
    { field: 'accountId', operator: 'in', value: accountIds },
    { field: 'userId', operator: '==', value: userId }
  ]
});

// AFTER (correct)
const accountQuery = await queryDocuments('accounts', {
  where: [
    { field: 'accountId', operator: 'in', value: accountIds },
    { field: 'userId', operator: '==', value: userId }
  ]
});
```

## Files Changed

- `/src/functions/plaid/syncPlaidTransactions.ts` (line 388)

## Deployment

```bash
npm run build
firebase deploy --only functions:onPlaidItemCreated,functions:syncTransactionsCallable
```

Deployed: 2025-10-13

## Next Steps

### For Existing Account

The account you just added needs to be re-synced to import transactions:

1. **Option 1: Re-link the account**
   - Remove the Plaid account from the app
   - Re-add it through Plaid Link
   - The trigger will run again with the fix

2. **Option 2: Manual sync (if you have a sync button in the app)**
   - Trigger a manual transaction sync
   - This will use the fixed query

3. **Option 3: Trigger webhook manually**
   - Use the Plaid Dashboard to fire a test webhook
   - The webhook handler will run the sync

### Testing

To verify the fix is working, check the logs after adding a new account:

```bash
firebase functions:log --only onPlaidItemCreated | head -50
```

Look for:
```
Looking for 1 unique accounts
Found 1 accounts  <-- Should now find the accounts!
Created X Family Finance transactions with splits from Y Plaid transactions
```

## Related Issues

This also explains why you may not have been seeing transactions for other accounts if they were recently added. All future account additions will now work correctly.

## Collection Naming Convention

Going forward, we should use consistent naming:

### Current Collections
- ✅ `accounts` - Bank accounts (correct name)
- ✅ `transactions` - Transactions with splits (correct name)
- ✅ `plaid_items` - Plaid item metadata (correct name)
- ✅ `outflows` - Recurring outflows (correct name)
- ✅ `inflows` - Recurring inflows (correct name)

### Deprecated Collections (if they exist)
- ❌ `plaid_accounts` - Should not be used
- ❌ `plaid_transactions` - Should not be used

All queries should use the correct collection names listed above.

## Prevention

To prevent this issue in the future:

1. **Use constants for collection names:**
   ```typescript
   // Create a constants file
   export const COLLECTIONS = {
     ACCOUNTS: 'accounts',
     TRANSACTIONS: 'transactions',
     PLAID_ITEMS: 'plaid_items',
     OUTFLOWS: 'outflows',
     INFLOWS: 'inflows'
   } as const;
   ```

2. **Use the constants in all queries:**
   ```typescript
   const accountQuery = await queryDocuments(COLLECTIONS.ACCOUNTS, {
     where: [...]
   });
   ```

This would make collection name mismatches a TypeScript error instead of a runtime bug.
