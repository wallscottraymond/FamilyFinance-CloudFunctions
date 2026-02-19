# Testing Strategy for FamilyFinance Cloud Functions

## Overview

This document standardizes the testing strategy for the FamilyFinance Cloud Functions backend. It establishes patterns, conventions, and best practices for writing comprehensive, maintainable tests that ensure code quality and reliability.

---

## Table of Contents

1. [Testing Infrastructure](#testing-infrastructure)
2. [Test Types](#test-types)
3. [Test Organization](#test-organization)
4. [Testing Patterns](#testing-patterns)
5. [Mock Strategies](#mock-strategies)
6. [Test Data Management](#test-data-management)
7. [Running Tests](#running-tests)
8. [Coverage Guidelines](#coverage-guidelines)
9. [Best Practices](#best-practices)
10. [Troubleshooting](#troubleshooting)

---

## Testing Infrastructure

### Frameworks and Tools

The project uses the following testing stack:

| Tool | Version | Purpose |
|------|---------|---------|
| Jest | ^29.7.0 | Test runner and assertion library |
| ts-jest | ^29.1.1 | TypeScript support for Jest |
| firebase-functions-test | ^3.1.1 | Firebase Functions mocking utilities |
| @firebase/rules-unit-testing | ^5.0.0 | Firestore security rules testing |

### Jest Configuration

**Location:** `/jest.config.js`

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/__emulator_tests__'],
  testMatch: [
    '**/__tests__/**/*.+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/index.ts'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  testTimeout: 10000
};
```

### NPM Scripts

```json
{
  "test": "jest",
  "test:watch": "jest --watch",
  "test:emulator": "jest __emulator_tests__"
}
```

---

## Test Types

### 1. Unit Tests

**Purpose:** Test individual functions, utilities, and business logic in isolation.

**Location:** `src/**/__tests__/*.test.ts`

**Characteristics:**
- Mocked dependencies (Firestore, external APIs)
- Fast execution (<100ms per test)
- No network or database access
- Single responsibility focus

**Example Files:**
- `src/utils/__tests__/encryption.test.ts`
- `src/functions/budgets/utils/__tests__/reassignTransactions.test.ts`
- `src/functions/transactions/utils/__tests__/matchTransactionSplitsToBudgets.test.ts`
- `src/functions/outflows/outflow_periods/__tests__/calculateOutflowPeriodStatus.test.ts`

### 2. Integration Tests

**Purpose:** Test how multiple components work together within the application.

**Location:** `src/**/__tests__/*.integration.test.ts`

**Characteristics:**
- May use real or mocked Firestore
- Test component interactions
- Longer execution time acceptable
- Focus on data flow between systems

**Example Files:**
- `src/functions/transactions/__tests__/transactionCRUD.integration.test.ts`

### 3. End-to-End (E2E) Tests

**Purpose:** Test complete user workflows against the Firebase emulator.

**Location:** `__emulator_tests__/*.emulator.test.ts` or `src/**/__tests__/*.e2e.test.ts`

**Characteristics:**
- Run against Firebase emulators
- Test full system behavior
- Include trigger executions
- Verify security rules
- Longer execution time (may include waits for triggers)

**Example Files:**
- `__emulator_tests__/everythingElseBudget.emulator.test.ts`
- `src/functions/budgets/__tests__/createTestBudgetSuite.e2e.test.ts`

### 4. Security Rules Tests

**Purpose:** Validate Firestore security rules using rule unit testing.

**Location:** `src/__tests__/security/*.test.ts`

**Characteristics:**
- Use `@firebase/rules-unit-testing`
- Test rule validation without running functions
- Fast, isolated security verification

**Example Files:**
- `src/__tests__/security/firestore-rules-validation.test.ts`
- `src/__tests__/security/transaction-rules.test.ts`

---

## Test Organization

### Directory Structure

```
FamilyFinance-CloudFunctions/
├── __emulator_tests__/              # E2E tests against emulators
│   ├── README.md
│   ├── QUICKSTART.md
│   └── *.emulator.test.ts
│
├── src/
│   ├── __tests__/                   # Shared/cross-cutting tests
│   │   └── security/                # Security rules tests
│   │       ├── firestore-rules-validation.test.ts
│   │       └── transaction-rules.test.ts
│   │
│   ├── utils/
│   │   └── __tests__/               # Utility function tests
│   │       ├── encryption.test.ts
│   │       ├── plaidClientFactory.test.ts
│   │       └── budgetSpending.test.ts
│   │
│   └── functions/
│       ├── budgets/
│       │   ├── __tests__/           # Budget function tests
│       │   ├── utils/__tests__/     # Budget utility tests
│       │   └── admin/__tests__/     # Admin function tests
│       │
│       ├── transactions/
│       │   ├── __tests__/           # Transaction function tests
│       │   └── utils/__tests__/     # Transaction utility tests
│       │
│       ├── outflows/
│       │   └── outflow_periods/
│       │       └── __tests__/       # Outflow period tests
│       │
│       └── plaid/
│           └── utils/__tests__/     # Plaid utility tests
│
└── TESTING.md                       # This document
```

### File Naming Conventions

| Pattern | Purpose | Example |
|---------|---------|---------|
| `*.test.ts` | Unit tests | `encryption.test.ts` |
| `*.integration.test.ts` | Integration tests | `transactionCRUD.integration.test.ts` |
| `*.e2e.test.ts` | End-to-end tests | `createTestBudgetSuite.e2e.test.ts` |
| `*.emulator.test.ts` | Emulator-based tests | `everythingElseBudget.emulator.test.ts` |

---

## Testing Patterns

### AAA Pattern (Arrange-Act-Assert)

All tests MUST follow the Arrange-Act-Assert pattern:

```typescript
describe('functionName', () => {
  it('should [expected behavior]', async () => {
    // ARRANGE: Set up test data and mocks
    const testData = createTestBudget({ amount: 500 });
    const mockFirestore = setupMockFirestore([testData]);

    // ACT: Execute the function under test
    const result = await functionUnderTest(testData);

    // ASSERT: Verify expected outcomes
    expect(result.success).toBe(true);
    expect(result.data.amount).toBe(500);
  });
});
```

### Documentation Header

Every test file SHOULD begin with a documentation block:

```typescript
/**
 * @file matchTransactionSplitsToBudgets.test.ts
 * @description Comprehensive tests for budget assignment logic
 *
 * FUNCTIONALITY TESTED:
 * - Regular budget matching by date range
 * - Ongoing vs limited budget behavior
 * - "Everything Else" budget fallback
 * - Multi-split transaction handling
 * - Edge cases (boundary dates, missing data)
 *
 * EXPECTED OUTCOMES:
 * - Transactions matched to correct budgets
 * - Fallback to "Everything Else" when no match
 * - Split preservation during matching
 *
 * DEPENDENCIES:
 * - Mocked Firestore (db.collection)
 * - Mocked budget and transaction data
 *
 * RELATED FILES:
 * - src/functions/transactions/utils/matchTransactionSplitsToBudgets.ts
 * - src/types/index.ts (Transaction, Budget types)
 */
```

### Test Structure

Tests should be organized in logical describe blocks:

```typescript
describe('FunctionName', () => {
  // Setup and teardown
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Cleanup if needed
  });

  // Group by functionality
  describe('Happy Path', () => {
    it('should handle normal input correctly', async () => {
      // ...
    });
  });

  describe('Edge Cases', () => {
    it('should handle boundary dates', async () => {
      // ...
    });

    it('should handle empty arrays', async () => {
      // ...
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid input gracefully', async () => {
      // ...
    });

    it('should handle Firestore errors', async () => {
      // ...
    });
  });

  describe('Performance', () => {
    it('should process 100 items efficiently', async () => {
      // ...
    });
  });
});
```

---

## Mock Strategies

### Mocking Firebase Admin

```typescript
// Mock Firebase Admin initialization
jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn()
  },
  firestore: jest.fn(() => ({
    settings: jest.fn()
  }))
}));

// Mock Firestore functions
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
  Timestamp: {
    now: jest.fn(() => ({ toDate: () => new Date() })),
    fromDate: jest.fn((date: Date) => ({
      toDate: () => date,
      toMillis: () => date.getTime()
    }))
  }
}));
```

### Mocking the Database Instance

```typescript
// Mock the db export from index.ts
jest.mock('../../index', () => ({
  db: {
    collection: jest.fn()
  }
}));

import { db } from '../../index';

// In tests, configure mock responses
(db.collection as jest.Mock).mockReturnValue({
  where: jest.fn().mockReturnThis(),
  get: jest.fn().mockResolvedValue({
    empty: false,
    size: 1,
    docs: mockDocs,
    forEach: (cb: any) => mockDocs.forEach(cb)
  })
});
```

### Mocking Firebase Functions Params

```typescript
jest.mock('firebase-functions/params', () => ({
  defineSecret: jest.fn(() => ({
    value: () => 'mock-secret-value'
  }))
}));
```

### Creating Mock Firestore Snapshots

```typescript
const createMockSnapshot = (docs: any[]) => ({
  docs,
  size: docs.length,
  empty: docs.length === 0,
  forEach: (callback: (doc: any) => void) => docs.forEach(callback)
});

const createMockDoc = (id: string, data: any) => ({
  id,
  exists: true,
  data: () => data,
  ref: {
    update: jest.fn(),
    delete: jest.fn()
  }
});
```

### Mocking Batch Operations

```typescript
const createMockBatch = () => {
  const updates: any[] = [];
  return {
    update: jest.fn((ref, data) => updates.push({ ref, data })),
    set: jest.fn((ref, data) => updates.push({ ref, data })),
    delete: jest.fn((ref) => updates.push({ ref, delete: true })),
    commit: jest.fn().mockResolvedValue(undefined),
    _updates: updates
  };
};
```

---

## Test Data Management

### Creating Test Data Factories

Create reusable factory functions for test data:

```typescript
// In test file or separate helpers file
import { Timestamp } from 'firebase-admin/firestore';
import { Transaction, TransactionStatus, TransactionType } from '../../types';

const createTestTransaction = (
  overrides: Partial<Transaction> = {}
): Transaction => {
  const now = new Date();
  return {
    id: `txn_test_${Date.now()}`,
    transactionId: `txn_test_${Date.now()}`,
    ownerId: 'user_test_001',
    groupId: null,
    transactionDate: Timestamp.fromDate(now),
    accountId: 'account_test',
    createdBy: 'user_test_001',
    updatedBy: 'user_test_001',
    currency: 'USD',
    description: 'Test Transaction',
    internalDetailedCategory: null,
    internalPrimaryCategory: null,
    plaidDetailedCategory: 'GENERAL_MERCHANDISE_OTHER',
    plaidPrimaryCategory: 'GENERAL_MERCHANDISE',
    plaidItemId: 'item_test',
    source: 'manual',
    transactionStatus: TransactionStatus.APPROVED,
    type: TransactionType.EXPENSE,
    name: 'Test Transaction',
    merchantName: null,
    splits: [{
      splitId: 'split_001',
      budgetId: 'unassigned',
      amount: 100,
      // ... all required split fields
    }],
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides
  };
};

const createTestBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'budget_test',
  name: 'Test Budget',
  amount: 500,
  startDate: Timestamp.fromDate(new Date('2025-01-01')),
  isOngoing: true,
  isSystemEverythingElse: false,
  // ... all required fields
  ...overrides
});
```

### Using Type Definitions

Always reference type definitions from `src/types/` to ensure test data matches production structures:

```typescript
import {
  Transaction,
  TransactionStatus,
  TransactionType,
  Budget,
  BudgetPeriod,
  PeriodType
} from '../../types';
```

### Mock Data Principles

1. **Match Production Structure**: Test data should exactly match the Firestore document structure
2. **Use Proper Timestamps**: Always use `Timestamp.fromDate()` for date fields
3. **Include All Required Fields**: Don't skip optional fields that might affect logic
4. **Use Realistic Values**: Amounts, dates, and IDs should be realistic
5. **Document Relationships**: Ensure related IDs reference each other correctly

---

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- src/utils/__tests__/encryption.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="should encrypt"

# Run with coverage
npm test -- --coverage
```

### Emulator Tests

```bash
# Terminal 1: Start emulators
firebase emulators:start --only functions,auth,firestore

# Terminal 2: Run emulator tests
npm run test:emulator
```

### Running Specific Test Types

```bash
# Unit tests only (exclude emulator tests)
npm test -- --testPathIgnorePatterns="__emulator_tests__"

# Integration tests only
npm test -- --testPathPattern="\.integration\.test\.ts$"

# E2E tests only
npm test -- --testPathPattern="(\.e2e\.test\.ts|\.emulator\.test\.ts)$"
```

---

## Coverage Guidelines

### Coverage Targets

| Category | Target | Priority |
|----------|--------|----------|
| Critical business logic | >90% | High |
| Utility functions | >80% | High |
| Cloud Functions (CRUD) | >70% | Medium |
| Triggers | >60% | Medium |
| Error handlers | >50% | Low |

### Critical Areas Requiring High Coverage

1. **Budget Spending Calculations** (`budgetSpending.ts`)
   - Spending delta calculations
   - Period matching logic
   - Multi-split handling

2. **Transaction Assignment** (`matchTransactionSplitsToBudgets.ts`)
   - Budget date range matching
   - "Everything Else" fallback
   - Category matching

3. **Encryption** (`encryption.ts`)
   - Token encryption/decryption
   - Tamper detection
   - Migration functions

4. **Security Rules Validation**
   - All collection rules tested
   - Permission boundaries verified

### Viewing Coverage Reports

```bash
# Generate coverage report
npm test -- --coverage

# Open HTML report
open coverage/lcov-report/index.html
```

---

## Best Practices

### DO

- **Use descriptive test names** that explain the scenario
  ```typescript
  it('should assign transaction to "everything else" budget when no regular budget matches date range')
  ```

- **Test one concept per test** (multiple related expects are OK)

- **Use helper factories** for consistent test data creation

- **Mock at the boundary** (Firestore, external APIs)

- **Test both success and failure paths**

- **Include boundary conditions** (first day of month, last day, etc.)

- **Clean up after tests** in `afterEach` or `afterAll`

- **Use `beforeEach` to reset mocks**
  ```typescript
  beforeEach(() => {
    jest.clearAllMocks();
  });
  ```

- **Test async errors properly**
  ```typescript
  await expect(asyncFunction()).rejects.toThrow('Expected error');
  ```

### DON'T

- **Don't test implementation details** - test behavior, not internals

- **Don't use shared mutable state** between tests

- **Don't rely on test execution order**

- **Don't use `any` types** - maintain type safety in tests

- **Don't skip writing tests** for "simple" functions

- **Don't mock too deeply** - prefer testing integrated behavior

- **Don't forget to await async operations**

- **Don't use hardcoded dates** that will cause tests to fail in the future
  ```typescript
  // BAD
  const date = new Date('2025-01-15');

  // GOOD
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), 15);
  ```

### Test Isolation

Each test must be completely independent:

```typescript
describe('MyFunction', () => {
  let mockDb: any;
  let mockBatch: any;

  beforeEach(() => {
    // Fresh mocks for each test
    jest.clearAllMocks();

    mockBatch = {
      update: jest.fn(),
      commit: jest.fn().mockResolvedValue(undefined)
    };

    mockDb = {
      collection: jest.fn(),
      batch: jest.fn(() => mockBatch)
    };

    (getFirestore as jest.Mock).mockReturnValue(mockDb);
  });

  // Tests can now run in any order
});
```

---

## Troubleshooting

### Common Issues

#### "Cannot find module" errors

```bash
# Ensure TypeScript is compiled
npm run build

# Clear Jest cache
npm test -- --clearCache
```

#### Firestore mock not working

Ensure mocks are set up before imports:

```typescript
// CORRECT: Mock before import
jest.mock('firebase-admin/firestore', () => ({...}));
import { getFirestore } from 'firebase-admin/firestore';

// WRONG: Import before mock
import { getFirestore } from 'firebase-admin/firestore';
jest.mock('firebase-admin/firestore', () => ({...}));
```

#### Tests timing out

Increase timeout for slow tests:

```typescript
it('should handle long operation', async () => {
  // ...
}, 30000); // 30 second timeout

// Or globally in jest.config.js
testTimeout: 15000
```

#### Emulator tests failing

1. Ensure emulators are running
2. Check ports are available (8080, 9099, 5001)
3. Verify functions are built: `npm run build`
4. Check emulator UI at http://localhost:4000

### Debug Tips

```typescript
// Add debug logging
console.log('Mock called with:', mockFunction.mock.calls);

// Inspect mock results
console.log('Mock returned:', mockFunction.mock.results);

// Check if mock was called
expect(mockFunction).toHaveBeenCalledWith(
  expect.objectContaining({ key: 'value' })
);
```

---

## Current Test Inventory

### Existing Test Files

| File | Type | Coverage | Notes |
|------|------|----------|-------|
| `encryption.test.ts` | Unit | High | Comprehensive crypto tests |
| `budgetSpending.test.ts` | Unit | High | Budget calculation tests |
| `matchTransactionSplitsToBudgets.test.ts` | Unit | High | Budget assignment tests |
| `reassignTransactions.test.ts` | Unit | Medium | Category reassignment tests |
| `calculateOutflowPeriodStatus.test.ts` | Unit | High | Outflow status tests |
| `calculateAllOccurrencesInPeriod.test.ts` | Unit | High | Occurrence tracking tests |
| `firestore-rules-validation.test.ts` | Security | Medium | Rules syntax validation |
| `transactionCRUD.integration.test.ts` | Integration | Medium | Transaction operations |
| `createTestBudgetSuite.e2e.test.ts` | E2E | Medium | Budget creation flow |
| `everythingElseBudget.emulator.test.ts` | Emulator | High | Complete budget workflow |

### Areas Needing More Tests

1. **Cloud Functions CRUD Operations**
   - `createTransaction.ts`
   - `updateBudget.ts`
   - `deleteBudget.ts`

2. **Firestore Triggers**
   - `onTransactionCreate.ts`
   - `onTransactionUpdate.ts`
   - `onTransactionDelete.ts`

3. **Plaid Integration**
   - `syncTransactions.ts`
   - `webhookHandler.ts`

4. **User Management**
   - `onUserCreate.ts`
   - User profile operations

---

## Contributing

When adding new features:

1. **Write tests first** (TDD) or alongside the feature
2. **Follow the patterns** established in this document
3. **Update test documentation** if adding new patterns
4. **Ensure all tests pass** before submitting PR
5. **Maintain or improve** coverage percentages

---

## References

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Firebase Functions Testing](https://firebase.google.com/docs/functions/unit-testing)
- [Firestore Rules Testing](https://firebase.google.com/docs/firestore/security/test-rules-emulator)
- [ts-jest Documentation](https://kulshekhar.github.io/ts-jest/)

---

**Last Updated:** January 2026
**Version:** 1.0
**Maintainer:** Family Finance Team
