# Emulator End-to-End Tests

Comprehensive end-to-end tests for the "Everything Else" budget system that run against the Firebase emulator.

## Prerequisites

1. **Firebase CLI** installed and authenticated
2. **Firebase Emulators** installed:
   ```bash
   firebase init emulators
   ```

3. **Node.js 20** (same version as Cloud Functions)

## Running the Tests

### Step 1: Start the Emulators

In one terminal, start the Firebase emulators:

```bash
# From the Cloud Functions directory
cd FamilyFinance-CloudFunctions

# Start emulators with functions, auth, and firestore
firebase emulators:start --only functions,auth,firestore
```

Wait for the message: `All emulators ready!`

### Step 2: Run the Tests

In another terminal, run the emulator tests:

```bash
# From the Cloud Functions directory
cd FamilyFinance-CloudFunctions

# Run emulator tests
npm run test:emulator
```

Or run a specific test file:

```bash
npm run test:emulator -- __emulator_tests__/everythingElseBudget.emulator.test.ts
```

## What the Tests Verify

The emulator tests verify the complete "Everything Else" budget flow:

### 1. User Signup Integration
- ✅ "Everything else" budget is auto-created when user signs up
- ✅ Budget has correct configuration (amount: $0, no categories, recurring, etc.)

### 2. Transaction Matching
- ✅ Unmatched transactions are assigned to "everything else" budget
- ✅ Regular budgets take priority when they match
- ✅ Priority matching works correctly

### 3. Deletion Prevention
- ✅ Deletion attempts are rejected by security rules
- ✅ Budget remains intact after deletion attempts

### 4. Update Restrictions
- ✅ Amount updates are rejected
- ✅ Category updates are rejected
- ✅ System flag modifications are rejected
- ✅ Name updates are allowed

### 5. Auto-Recreation Safety Net
- ✅ Budget is automatically recreated if deleted via admin
- ✅ onBudgetDelete trigger fires correctly
- ✅ New budget has correct configuration

### 6. Migration Function
- ✅ Migration detects existing budgets and skips
- ✅ No duplicate budgets are created

### 7. Budget Period Generation
- ✅ Budget periods are created for "everything else" budget
- ✅ Periods have correct allocation (amount: $0)

### 8. Complete Workflow
- ✅ End-to-end user journey works seamlessly

## Test Output

When tests run successfully, you'll see output like:

```
✅ Created test user: abc123...
✅ "Everything else" budget created: budget_xyz...
✅ Transaction assigned to "everything else" budget
✅ Transaction matched regular budget (not "everything else")
✅ Deletion prevented: permission-denied
✅ Budget still exists after deletion attempt
✅ Amount update prevented: permission-denied
✅ CategoryIds update prevented: permission-denied
✅ System flag modification prevented: permission-denied
✅ Name update allowed: "Miscellaneous Spending"
🗑️ Deleted "everything else" budget via admin
✅ Budget auto-recreated: budget_new...
✅ Migration function would skip user (budget exists)
✅ Found 78 budget periods for "everything else" budget

📋 Complete Workflow Test:
1. ✅ User signed up
2. ✅ "Everything else" budget auto-created
3. ✅ Unmatched transaction assigned to "everything else"
4. ✅ Regular budget takes priority when matched
5. ✅ Deletion prevented by security rules
6. ✅ Amount updates rejected
7. ✅ Name updates allowed
8. ✅ Auto-recreation works if deleted
9. ✅ Budget periods generated correctly

✅ Complete workflow verified successfully!

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

## Troubleshooting

### Emulators not starting

**Error:** `Port 8080 already in use`

**Solution:** Kill the process using the port:
```bash
lsof -ti:8080 | xargs kill -9
lsof -ti:9099 | xargs kill -9
```

### Tests failing

**Error:** `ECONNREFUSED localhost:8080`

**Solution:** Ensure emulators are running before running tests.

### Functions not deploying to emulator

**Error:** `Function not found`

**Solution:** Make sure functions are built before starting emulators:
```bash
npm run build
firebase emulators:start
```

### Security rules errors

**Error:** `PERMISSION_DENIED: Missing or insufficient permissions`

**Solution:** Verify firestore.rules are loaded correctly in the emulator.

## Environment Configuration

The tests automatically configure the emulator environment:

```typescript
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
```

Default emulator ports:
- **Firestore:** 8080
- **Auth:** 9099
- **Functions:** 5001
- **Emulator UI:** 4000

## Cleanup

Tests automatically clean up test users after completion. If cleanup fails, you can manually clear emulator data:

```bash
# Clear all emulator data
firebase emulators:export ./emulator-backup --force
firebase emulators:start --import=./emulator-backup
```

Or restart emulators (data is not persisted by default).

## Continuous Integration

To run emulator tests in CI:

```yaml
# Example GitHub Actions workflow
- name: Start Firebase Emulators
  run: firebase emulators:start --only functions,auth,firestore &

- name: Wait for Emulators
  run: sleep 10

- name: Run Emulator Tests
  run: npm run test:emulator
```

## Next Steps

After tests pass:

1. **Deploy to staging environment**
2. **Run production migration** (createMissingEverythingElseBudgets)
3. **Monitor Cloud Function logs**
4. **Verify with real users**
