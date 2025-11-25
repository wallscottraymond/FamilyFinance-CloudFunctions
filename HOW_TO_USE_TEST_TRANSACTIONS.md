# How to Use createTestTransactions

## Overview

I've created an improved `createTestTransactions` function located at:
```
src/functions/transactions/dev/createTestTransactions.ts
```

This function seeds test transaction data into your local Firestore emulator using the **exact same production pipeline** that processes real Plaid transactions.

## What's Different from the Old Version?

### Location
- **Old:** `src/functions/transactions/admin/createTestTransactions.ts`
- **New:** `src/functions/transactions/dev/createTestTransactions.ts` ✅

### Improvements
1. ✅ **Better error handling** - Validates user exists before attempting to create transactions
2. ✅ **Verification step** - Reads back created transactions from Firestore to confirm they were written
3. ✅ **More detailed logging** - Shows each step of the pipeline with status emojis
4. ✅ **Proper database connection** - Uses the shared `db` instance from main index
5. ✅ **Better error messages** - Tells you exactly what went wrong and how to fix it
6. ✅ **Returns transaction IDs** - Lists all created transaction IDs for easy verification

## Quick Start

### 1. Start Firebase Emulators

```bash
cd /path/to/FamilyFinance-CloudFunctions
firebase emulators:start
```

You should see output like:
```
✔  All emulators ready! It is now safe to connect your app.
┌─────────────────────────────────────────────────────────────┐
│ ✔  All emulators ready! View status and logs at http://localhost:4000 │
└─────────────────────────────────────────────────────────────┘

┌───────────┬────────────────┬─────────────────────────────────┐
│ Emulator  │ Host:Port      │ View in Emulator UI             │
├───────────┼────────────────┼─────────────────────────────────┤
│ Functions │ localhost:5001 │ http://localhost:4000/functions │
│ Firestore │ localhost:8080 │ http://localhost:4000/firestore │
│ Auth      │ localhost:9099 │ http://localhost:4000/auth      │
└───────────┴────────────────┴─────────────────────────────────┘
```

### 2. Find Your Project ID

Check `.firebaserc`:
```bash
cat .firebaserc
```

Example output:
```json
{
  "projects": {
    "default": "family-finance-dev"
  }
}
```

Your project ID is `family-finance-dev`.

### 3. Get a Valid User ID

Open the Firestore Emulator UI and find a user:
```
http://localhost:4000/firestore/data/users
```

Copy a user document ID (e.g., `IKzBkwEZb6MdJkdDVnVyTFAFj5i1`)

### 4. Call the Function

Replace `YOUR_PROJECT_ID` and `YOUR_USER_ID` with your values:

```bash
curl "http://localhost:5001/YOUR_PROJECT_ID/us-central1/createTestTransactions?userId=YOUR_USER_ID"
```

**Example:**
```bash
curl "http://localhost:5001/family-finance-dev/us-central1/createTestTransactions?userId=IKzBkwEZb6MdJkdDVnVyTFAFj5i1"
```

### 5. Verify in Firestore UI

Open the Firestore UI and check the `transactions` collection:
```
http://localhost:4000/firestore/data/transactions
```

You should see a new transaction with description: **"PURCHASE WM SUPERCENTER #1700"**

## Expected Output

### Success Response

```json
{
  "success": true,
  "message": "✅ Successfully created 1 test transactions",
  "data": {
    "targetUserId": "IKzBkwEZb6MdJkdDVnVyTFAFj5i1",
    "testItemId": "test_plaid_item_1700000000000",
    "currency": "USD",
    "transactionsAdded": 1,
    "transactionsModified": 1,
    "transactionsRemoved": 1,
    "createdTransactionIds": [
      "lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje"
    ],
    "errors": []
  },
  "hint": "Check your Firestore emulator UI to see the created transactions"
}
```

### Logs in Terminal

The emulator terminal will show detailed logs:

```
═══════════════════════════════════════════════════════════
🧪 DEV: Creating Test Transactions
═══════════════════════════════════════════════════════════

🔍 Verifying user exists: IKzBkwEZb6MdJkdDVnVyTFAFj5i1
✅ User verified: test@example.com

📋 Test Configuration:
  - User ID: IKzBkwEZb6MdJkdDVnVyTFAFj5i1
  - Item ID: test_plaid_item_1700000000000
  - Currency: USD
  - Transactions to add: 1

═══════════════════════════════════════════════════════════
💳 PROCESSING ADDED TRANSACTIONS (6-Step Pipeline)
═══════════════════════════════════════════════════════════

⚙️  Step 1/6: Formatting transactions...
   ✅ Formatted 1 transactions
   📊 First transaction: PURCHASE WM SUPERCENTER #1700

⚙️  Step 2/6: Matching categories...
   ✅ Matched categories for 1 transaction splits

⚙️  Step 3/6: Matching source periods...
   ✅ Matched 1 transaction splits to source periods

⚙️  Step 4/6: Matching budgets...
   ✅ Matched budget IDs for 1 transaction splits

⚙️  Step 5/6: Matching outflows...
   ✅ Matched outflow IDs for 1 transaction splits
   ✅ Generated 0 outflow updates

⚙️  Step 6/6: Batch creating transactions in Firestore...
   🔍 Database instance: Connected
   🔍 Transactions to create: 1
   📝 Transaction 1: lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje - PURCHASE WM SUPERCENTER #1700 ($72.10)
   ✅ Created 1 transactions in Firebase

🔍 Verifying transactions in Firestore...
   ✅ Verified: lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje - PURCHASE WM SUPERCENTER #1700 ($72.10)

═══════════════════════════════════════════════════════════
🎉 TEST TRANSACTION CREATION COMPLETE!
═══════════════════════════════════════════════════════════

📈 Results:
   💳 Transactions Added: 1
   💳 Transactions Modified: 1 (simulated)
   💳 Transactions Removed: 1 (simulated)
   ⚠️  Errors: 0
```

## Troubleshooting

### "User not found" Error

**Problem:**
```json
{
  "success": false,
  "error": "User not found: invalid-user-id"
}
```

**Solution:**
1. Open Firestore UI: http://localhost:4000/firestore
2. Navigate to `users` collection
3. Copy a valid user document ID
4. Use that ID in your curl command

### No Transactions Appearing

**Check 1: Are emulators running?**
```bash
# Should return a JSON response
curl http://localhost:4000
```

**Check 2: Look for errors in response**
```bash
curl "http://localhost:5001/YOUR_PROJECT_ID/us-central1/createTestTransactions?userId=YOUR_USER_ID" | jq .errors
```

**Check 3: View function logs**
Look at the terminal where you ran `firebase emulators:start` for detailed error messages.

### Function Not Found

**Problem:**
```
Error: Function createTestTransactions not found
```

**Solution:**
1. Make sure you ran `npm run build`:
   ```bash
   npm run build
   ```

2. Restart the emulators:
   ```bash
   # Press Ctrl+C to stop emulators
   firebase emulators:start
   ```

## Test Data Details

The function creates transactions from this simulated Plaid response:

### Transaction 1: Walmart Purchase (ADDED)
- **Amount:** $72.10
- **Date:** 2023-09-24
- **Merchant:** Walmart
- **Category:** GENERAL_MERCHANDISE
- **Location:** Poway, CA
- **Status:** Posted (not pending)

### Transaction 2: DoorDash/Burger King (MODIFIED - Simulated Only)
- **Amount:** $28.34
- **Date:** 2023-09-28
- **Merchant:** Burger King (via DoorDash)
- **Category:** FOOD_AND_DRINK
- **Status:** Pending

### Transaction 3: Removed Transaction (REMOVED - Simulated Only)
- Only the ID is logged, no actual deletion occurs

## Next Steps

After successfully creating test transactions, you can:

1. **Test the Mobile App** - Connect your React Native app to the local emulator and verify transactions appear
2. **Test Budget Matching** - Create budgets and verify transactions are properly matched
3. **Test Outflow Matching** - Create recurring outflows and verify transactions are matched to bills
4. **Test Transaction Queries** - Query transactions by date, category, budget, etc.

## Need More Test Data?

You can modify the `SIMULATED_PLAID_RESPONSE` constant in the file to add more transactions. Just follow the same structure as the existing data.

---

**Location of function:** `src/functions/transactions/dev/createTestTransactions.ts`
**Documentation:** `src/functions/transactions/dev/README.md`
