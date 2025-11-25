# Transaction Development Functions

This directory contains development/testing functions for seeding test data into the local Firestore emulator.

## createTestTransactions

Seeds test transaction data by simulating a Plaid `/transactions/sync` response and running it through the complete production pipeline.

### What It Does

1. **Uses Static Test Data** - No actual Plaid API calls
2. **Runs Production Pipeline** - Same 6-step process as real Plaid sync:
   - Format: Plaid → Internal structure
   - Match Categories: Assigns categories to transaction splits
   - Match Source Periods: Maps to monthly/weekly/biweekly periods
   - Match Budgets: Links to active budgets
   - Match Outflows: Identifies bill payments
   - Batch Create: Atomic Firestore write
3. **Creates Real Transactions** - Actually writes to Firestore (not mocked)

### Prerequisites

1. **Firebase Emulators Running**
   ```bash
   cd /path/to/FamilyFinance-CloudFunctions
   firebase emulators:start
   ```

2. **User Must Exist**
   - You need a valid user ID in your local Firestore emulator
   - Check the Firestore UI at http://localhost:4000

### Usage

**Option 1: cURL**
```bash
# Replace YOUR_USER_ID with an actual user ID from your emulator
curl "http://localhost:5001/YOUR_PROJECT_ID/us-central1/createTestTransactions?userId=YOUR_USER_ID"
```

**Option 2: Browser**
```
http://localhost:5001/YOUR_PROJECT_ID/us-central1/createTestTransactions?userId=YOUR_USER_ID
```

**Option 3: Postman/Insomnia**
```
GET http://localhost:5001/YOUR_PROJECT_ID/us-central1/createTestTransactions
Query Params:
  - userId: YOUR_USER_ID
```

### Finding Your Project ID

Check `.firebaserc` in the Cloud Functions directory:
```json
{
  "projects": {
    "default": "your-project-id-here"
  }
}
```

### Expected Response

**Success:**
```json
{
  "success": true,
  "message": "✅ Successfully created 1 test transactions",
  "data": {
    "targetUserId": "IKzBkwEZb6MdJkdDVnVyTFAFj5i1",
    "testItemId": "test_plaid_item_1234567890",
    "currency": "USD",
    "transactionsAdded": 1,
    "transactionsModified": 1,
    "transactionsRemoved": 1,
    "createdTransactionIds": [
      "lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje"
    ],
    "errors": [],
    "simulatedResponse": {
      "accounts": 1,
      "added": 1,
      "modified": 1,
      "removed": 1
    }
  },
  "hint": "Check your Firestore emulator UI to see the created transactions"
}
```

**Error:**
```json
{
  "success": false,
  "error": "User not found: invalid-user-id",
  "hint": "Make sure the user exists in your local Firestore emulator"
}
```

### Verifying Results

1. **Open Firestore Emulator UI**
   ```
   http://localhost:4000
   ```

2. **Check `transactions` collection**
   - Should see new transactions with IDs from the response
   - Look for transaction with description "PURCHASE WM SUPERCENTER #1700"

3. **Check Cloud Functions Logs**
   - Terminal where emulators are running shows detailed pipeline logs
   - Look for "🎉 TEST TRANSACTION CREATION COMPLETE!"

### Test Data Included

The function creates transactions from this simulated Plaid response:

**Added (1 transaction):**
- Walmart purchase: $72.10
- Date: 2023-09-24
- Category: GENERAL_MERCHANDISE

**Modified (1 transaction - simulated only):**
- DoorDash/Burger King: $28.34
- Date: 2023-09-28
- Category: FOOD_AND_DRINK

**Removed (1 transaction - simulated only):**
- Account ID: BxBXxLj1m4HMXBm9WZZmCWVbPjX16EHwv99vp

### Troubleshooting

**"User not found" error:**
- Make sure your user ID is correct
- Check Firestore UI to verify user exists in `users` collection

**No transactions appearing in Firestore:**
- Check Cloud Functions logs for errors
- Verify emulators are running (http://localhost:4000 should load)
- Check response JSON for `errors` array

**"Cannot find module" error:**
- Run `npm run build` to compile TypeScript
- Make sure emulators reloaded after build

**Function not found:**
- Verify function is exported in `src/functions/transactions/index.ts`
- Check main `src/index.ts` exports transactions module
- Restart emulators after code changes

### Logs

The function provides extensive logging:
- ✅ Success steps (green checkmarks)
- ⚙️ Processing steps (gear icons)
- 🔍 Verification steps (magnifying glass)
- ❌ Errors (red X)
- 📊 Data summaries (chart icon)

Example log output:
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
   📊 First split category: general_merchandise

⚙️  Step 3/6: Matching source periods...
   ✅ Matched 1 transaction splits to source periods
   📊 First split periods: { monthly: 'period_123', weekly: 'period_456', biWeekly: 'period_789' }

⚙️  Step 4/6: Matching budgets...
   ✅ Matched budget IDs for 1 transaction splits
   📊 First split budget: budget_abc

⚙️  Step 5/6: Matching outflows...
   ✅ Matched outflow IDs for 1 transaction splits
   ✅ Generated 0 outflow updates

⚙️  Step 6/6: Batch creating transactions in Firestore...
   🔍 Database instance: Connected
   🔍 Transactions to create: 1
   📝 Transaction 1: lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje - PURCHASE WM SUPERCENTER #1700 ($72.1)
   ✅ Created 1 transactions in Firebase

🔍 Verifying transactions in Firestore...
   ✅ Verified: lPNjeW1nR6CDn5okmGQ6hEpMo4lLNoSrzqDje - PURCHASE WM SUPERCENTER #1700 ($72.1)

═══════════════════════════════════════════════════════════
🎉 TEST TRANSACTION CREATION COMPLETE!
═══════════════════════════════════════════════════════════

📈 Results:
   💳 Transactions Added: 1
   💳 Transactions Modified: 1 (simulated)
   💳 Transactions Removed: 1 (simulated)
   ⚠️  Errors: 0
```

## DO NOT Deploy to Production

These functions are for local development only. They should never be deployed to production.

To prevent accidental deployment, consider:
1. Using `.gitignore` patterns for dev functions
2. Conditional exports in index.ts based on environment
3. Firebase Functions deployment filters
