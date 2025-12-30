# Dev Functions Testing Guide

## Available Dev Functions

### 1. `createTestOutflows` (Callable Function)
**Purpose:** Simulates a complete Plaid recurring transaction sync pipeline

**Type:** Firebase Callable Function (requires authentication)

**Location:** `src/functions/outflows/outflow_main/dev/createTestOutflows.ts`

**What it does:**
1. Cleans up existing test data
2. Creates a test plaid_item
3. Simulates Plaid API response with:
   - 1 inflow stream (Platypus Payroll - semi-monthly)
   - 2 outflow streams (ConEd monthly, Costco annual)
4. Runs the complete pipeline: format → enhance → batch create
5. Triggers onOutflowCreated which generates outflow_periods
6. Returns detailed results

**How to test:**

#### Option A: From Mobile App
```typescript
import { getFunctions, httpsCallable } from '@react-native-firebase/functions';

const functions = getFunctions();
const createTest = httpsCallable(functions, 'createTestOutflows');

try {
  const result = await createTest({});
  console.log('Test Result:', result.data);
  // Output:
  // {
  //   success: true,
  //   message: "Simulated Plaid sync completed: ...",
  //   data: {
  //     inflowsCreated: 1,
  //     outflowsCreated: 2,
  //     outflowPeriodsCreated: 18,
  //     errors: []
  //   }
  // }
} catch (error) {
  console.error('Error:', error);
}
```

#### Option B: From Firebase CLI
```bash
firebase functions:call createTestOutflows --data '{}'
```

#### Option C: From Browser Console (if logged in to web app)
```javascript
const functions = firebase.functions();
const createTest = functions.httpsCallable('createTestOutflows');
createTest({}).then(result => console.log(result.data));
```

---

### 2. `debugOutflowPeriods` (HTTP Function)
**Purpose:** Query and inspect outflow_periods collection

**Type:** HTTP Request Function (public endpoint)

**Location:** `src/functions/outflows/outflow_main/dev/debugOutflowPeriods.ts`

**What it does:**
1. Queries up to 30 outflow_periods from Firestore
2. Identifies users with periods
3. Shows current vs historical periods
4. Returns detailed period information

**How to test:**

#### Option A: Direct HTTP Request
```bash
curl https://us-central1-family-budget-app-cb59b.cloudfunctions.net/debugOutflowPeriods
```

#### Option B: Browser
Navigate to: `https://us-central1-family-budget-app-cb59b.cloudfunctions.net/debugOutflowPeriods`

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "total": 18,
    "periods": [...],
    "users": ["IKzBkwEZb6MdJkdDVnVyTFAFj5i1"],
    "currentPeriods": [...],
    "currentUserResults": {...}
  }
}
```

---

## Current Issues & Fixes

### Issue 1: 503 Server Error
**Problem:** Functions return "Service not available yet"

**Possible Causes:**
- Cold start (first invocation takes 30-60 seconds)
- Runtime error during initialization
- Deployment incomplete

**Fix:**
1. Wait 30-60 seconds after deployment
2. Check function logs: `firebase functions:log`
3. Redeploy: `firebase deploy --only functions:createTestOutflows,functions:debugOutflowPeriods`

### Issue 2: Billing/Secret Manager Error
**Problem:** Deployment fails with "This API method requires billing"

**Error Message:**
```
Request to https://secretmanager.googleapis.com/v1/projects/family-budget-app-cb59b/secrets/TOKEN_ENCRYPTION_KEY had HTTP Error: 403
```

**Fix:**
The `createTestOutflows` function references `TOKEN_ENCRYPTION_KEY` secret indirectly through imports.

**Options:**
- **Option A (Recommended):** Enable billing for the project
- **Option B:** Remove secret dependencies from dev functions (if not needed for testing)
- **Option C:** Use emulator for local testing (no billing required)

### Issue 3: Function Not Deployed
**Problem:** Function doesn't appear in `firebase functions:list`

**Fix:**
```bash
# Build functions
npm run build

# Deploy specific functions
firebase deploy --only functions:createTestOutflows,functions:debugOutflowPeriods

# Or deploy all functions
firebase deploy --only functions
```

---

## Testing with Firebase Emulator (Local)

**Advantage:** No billing required, faster iteration

### Setup
```bash
# Start emulators
firebase emulators:start

# In another terminal, test the function
curl http://localhost:5001/family-budget-app-cb59b/us-central1/debugOutflowPeriods

# Or use Firebase CLI
firebase functions:call createTestOutflows --data '{}' --emulator
```

---

## Debugging Tips

### Check if functions are deployed
```bash
firebase functions:list | grep -E "createTestOutflows|debugOutflowPeriods"
```

### View function logs
```bash
# All logs
firebase functions:log

# Filter by function name
firebase functions:log | grep createTestOutflows
```

### Test with verbose logging
Add `console.log` statements to the functions and check logs immediately after calling.

### Check function status
```bash
# Get function details
firebase functions:get createTestOutflows
firebase functions:get debugOutflowPeriods
```

---

## Expected Test Results

### Successful `createTestOutflows` Output

**Console Logs:**
```
🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪
🧪 SIMULATING PLAID RECURRING TRANSACTION SYNC
🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪🧪

🧹 STEP 0: Cleaning up existing test data...
  ✅ Cleanup complete

📝 STEP 1: Creating test plaid_item...
  ✓ Created test plaid_item: xyz123

📡 STEP 2: Simulating Plaid /transactions/recurring/get response
  📥 Simulated Response:
    - Inflow Streams: 1
    - Outflow Streams: 2

💸 STARTING OUTFLOW PIPELINE (EXPENSES)
🔄 Step 1/3: Formatting outflow streams...
  ✅ Formatted 2 outflow streams
    1. ConEd Bill Payment - $85 MONTHLY
    2. Costco Annual Membership - $120 ANNUALLY

🔄 Step 2/3: Enhancing outflow streams...
  ✅ Enhanced 2 outflow streams
    1. ConEd Bill Payment
       - Type: utility
       - Essential: true
    2. Costco Annual Membership
       - Type: subscription
       - Essential: false

🔄 Step 3/3: Batch creating outflow streams...
   ⚡ This will trigger onOutflowCreated for each outflow
   ⚡ Which will auto-generate outflow_periods

  ✅ Created 2 outflows
  ✅ Updated 0 outflows

═══════════════════════════════════════════════════════════
🎉 SYNC SIMULATION COMPLETE!
═══════════════════════════════════════════════════════════

📈 Final Results:
  💰 Inflows Created: 1
  💰 Inflows Updated: 0
  💸 Outflows Created: 2
  💸 Outflows Updated: 0
  📅 Outflow Periods Created: 18
  ⚠️  Errors: 0
```

**Return Value:**
```json
{
  "success": true,
  "message": "Simulated Plaid sync completed: 1 inflows, 2 outflows, 18 periods",
  "data": {
    "inflowsCreated": 1,
    "outflowsCreated": 2,
    "outflowPeriodsCreated": 18,
    "errors": []
  }
}
```

### Successful `debugOutflowPeriods` Output

```json
{
  "success": true,
  "data": {
    "total": 18,
    "periods": [
      {
        "id": "stream_coned_001_2025-M01",
        "userId": "IKzBkwEZb6MdJkdDVnVyTFAFj5i1",
        "outflowId": "stream_coned_001",
        "billAmount": 85,
        "isDuePeriod": true,
        "isCurrent": true
      },
      // ... more periods
    ],
    "users": ["IKzBkwEZb6MdJkdDVnVyTFAFj5i1"],
    "currentPeriods": [...]
  }
}
```

---

## Next Steps

1. **Enable billing** on the Firebase project (if deploying to production)
2. **Test in emulator** first (no billing required)
3. **Deploy functions** once ready: `firebase deploy --only functions`
4. **Call from mobile app** using the code samples above
5. **Check Firestore** for created test data:
   - `outflows` collection: 2 test outflows
   - `outflow_periods` collection: 18 test periods
   - `inflows` collection: 1 test inflow
   - `plaid_items` collection: 1 test plaid item

---

## Additional Dev Functions (Not Yet Listed)

Check `/src/functions/outflows/outflow_main/dev/` for more dev utilities:
- `simulatePlaidRecurring.ts`
- `testOutflowUpdate.ts`
