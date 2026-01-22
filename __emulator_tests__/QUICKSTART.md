# "Everything Else" Budget - Emulator Test Quick Start

## 🚀 Quick Start (2 Steps)

### Step 1: Start Emulators (Terminal 1)

```bash
cd FamilyFinance-CloudFunctions
firebase emulators:start --only functions,auth,firestore
```

Wait for: `✔  All emulators ready!`

### Step 2: Run Tests (Terminal 2)

```bash
cd FamilyFinance-CloudFunctions
npm run test:emulator
```

## 📊 What Gets Tested

### ✅ Complete End-to-End Flow

1. **User Signup** → "Everything else" budget auto-created
2. **Transaction Matching** → Unmatched transactions assigned to "everything else"
3. **Priority Matching** → Regular budgets take priority
4. **Deletion Prevention** → Cannot delete system budget
5. **Update Restrictions** → Amount edits rejected, name edits allowed
6. **Auto-Recreation** → Budget recreated if deleted via admin
7. **Budget Periods** → Periods generated correctly
8. **Migration** → Detects existing budgets

### 📋 Test Output Example

```
PASS __emulator_tests__/everythingElseBudget.emulator.test.ts
  Everything Else Budget - Emulator E2E Tests
    1. User Signup Integration
      ✓ should create "everything else" budget on user signup (2015ms)
    2. Transaction Matching
      ✓ should assign unmatched transaction to "everything else" budget (1023ms)
      ✓ should assign to regular budget first if match exists (1018ms)
    3. Deletion Prevention
      ✓ should reject deletion of "everything else" budget via Cloud Function (12ms)
      ✓ should verify budget still exists after deletion attempt (8ms)
    4. Update Restrictions
      ✓ should reject amount update on "everything else" budget (11ms)
      ✓ should reject categoryIds update on "everything else" budget (9ms)
      ✓ should reject isSystemEverythingElse flag modification (8ms)
      ✓ should allow name update on "everything else" budget (18ms)
    5. Auto-Recreation Safety Net
      ✓ should auto-recreate if budget is deleted via admin (3009ms)
    6. Migration Function
      ✓ should detect existing "everything else" budget and skip (7ms)
    7. Budget Period Generation
      ✓ should verify budget periods were created for "everything else" budget (12ms)
    8. Complete Workflow
      ✓ should handle complete user journey (9ms)

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
Snapshots:   0 total
Time:        8.156 s
```

## 🔧 Troubleshooting

### Port already in use?
```bash
lsof -ti:8080 | xargs kill -9
lsof -ti:9099 | xargs kill -9
lsof -ti:5001 | xargs kill -9
```

### Tests failing?
1. Ensure emulators are running first
2. Check emulator UI: http://localhost:4000
3. Verify functions are deployed in emulator

### Clean slate?
```bash
# Kill all emulators and restart fresh
pkill -f firebase
rm -rf ./emulator-data
firebase emulators:start --only functions,auth,firestore
```

## 📁 Test Files

- **Main Test:** `__emulator_tests__/everythingElseBudget.emulator.test.ts`
- **Full Docs:** `__emulator_tests__/README.md`

## 🎯 Next Steps After Tests Pass

1. **Verify deployment complete:**
   ```bash
   firebase functions:list | grep -E "createMissingEverythingElseBudgets|onBudgetDelete"
   ```

2. **Run migration for existing users:**
   ```bash
   firebase functions:call createMissingEverythingElseBudgets
   ```

3. **Monitor production:**
   ```bash
   firebase functions:log --only onBudgetDelete,createMissingEverythingElseBudgets
   ```

That's it! 🎉
