# Shared Utilities Directory

## Overview

The `/src/utils` directory contains 11 core utility files providing foundational services for authentication, database operations, Plaid integration, encryption, validation, and budget management. These utilities are the single source of truth for cross-functional business logic used throughout the Firebase Cloud Functions backend.

## Purpose

Shared utilities provide:
- **Authentication & Authorization** - Token verification, RBAC, permissions
- **Database Operations** - Generic CRUD, queries, batch operations
- **Plaid Integration** - API client, account management, encryption
- **Data Structure** - Hybrid document builders with groupIds support
- **Validation** - Schema validation, business logic checks
- **Budget Management** - Spending calculations, period management

## Directory Structure

```
utils/
├── auth.ts                    # Authentication & authorization
├── budgetPeriods.ts          # Budget period management
├── budgetSpending.ts         # Budget spending calculations (PRIMARY)
├── documentStructure.ts      # Hybrid document builders
├── encryption.ts             # AES-256-GCM encryption
├── firestore.ts              # Generic Firestore CRUD
├── plaidAccounts.ts          # Plaid account data handling
├── plaidClient.ts            # Basic Plaid client (legacy)
├── plaidClientFactory.ts     # Advanced Plaid client with retry
├── plaidRecurring.ts         # Recurring transaction streams
├── validation.ts             # Request & business validation
└── __tests__/                # Unit tests
```

---

## Core Utilities

### auth.ts - Authentication & Authorization

**Purpose:** Centralized authentication, token verification, and role-based access control

**Key Functions:**

#### `authenticateRequest(req, options?)`
Flexible authentication for HTTP and callable functions
```typescript
interface AuthOptions {
  requiredRole?: UserRole;        // Minimum role required
  requireFamilyMembership?: boolean;
  requireActiveUser?: boolean;
}

const user = await authenticateRequest(request, {
  requiredRole: UserRole.EDITOR,
  requireFamilyMembership: true,
});
```

**Supports:**
- HTTP requests (onRequest functions)
- Callable requests (onCall functions)
- Custom token validation
- Role hierarchy checking
- Family membership validation

#### Role Hierarchy

```typescript
VIEWER < EDITOR < ADMIN
```

**Permissions:**
- `VIEWER`: Read-only access
- `EDITOR`: Can create/update resources
- `ADMIN`: Full access including deletions

#### `authMiddleware(requiredRole?)`
Express middleware for HTTP endpoints
```typescript
export const myFunction = onRequest(
  { cors: corsOptions },
  authMiddleware(UserRole.EDITOR),
  async (req, res) => {
    const user = (req as any).user;
    // User is authenticated and has EDITOR+ role
  }
);
```

#### Helper Functions
- `createSuccessResponse(data, message?)` - Standardized success
- `createErrorResponse(error, statusCode)` - Standardized errors
- `generateInviteCode()` - Random 6-char codes
- `hasRequiredRole(userRole, requiredRole)` - Hierarchy check
- `isFamilyMember(userId, familyId)` - Family membership check

**Issues Found:**
- ⚠️ **Uses legacy UserRole enum** instead of new RBAC (SystemRole, GroupRole, ResourceRole)
- ⚠️ **CORS validation allows all localhost** (line 285) - security risk
- ⚠️ **Family-centric** - doesn't support group-based sharing model

**Recommendations:**
- Migrate to new RBAC system
- Tighten CORS validation
- Add group-based permission checks

---

### budgetPeriods.ts - Budget Period Management

**Purpose:** Creates budget_periods from source_periods with proper amount allocation

**Key Functions:**

#### `createBudgetPeriodsFromSource(db, budgetId, budget, startDate, endDate)`
Main workflow for creating budget period instances
```typescript
const result = await createBudgetPeriodsFromSource(
  db,
  budgetId,
  budgetData,
  startDate,
  endDate
);

// Returns:
{
  count: 78,  // Total periods created
  periodIds: ['2025-M01', '2025-M02', ...],
  monthlyCount: 12,
  biMonthlyCount: 24,
  weeklyCount: 52,
  startPeriod: '2025-M01',
  endPeriod: '2025-M12',
}
```

**Process:**
1. Query source_periods in date range
2. Calculate allocated amount using `calculatePeriodAllocatedAmount()`
3. Build BudgetPeriodDocument objects
4. Batch create in Firestore (500 per batch)
5. Return comprehensive results

#### `batchCreateBudgetPeriods(db, periods)`
Efficient batch creation with 500-document limit
```typescript
await batchCreateBudgetPeriods(db, periodDocuments);
```

#### `updateBudgetPeriodRange(db, budgetId, periodRange)`
Updates budget metadata with period information
```typescript
await updateBudgetPeriodRange(db, budgetId, {
  startPeriod: '2025-M01',
  endPeriod: '2025-M12',
  lastExtended: Timestamp.now(),
});
```

**Issues Found:**
- ⚠️ **Type conversion fragility** - Manual BudgetPeriod → PeriodType mapping
- ⚠️ **String coercion** - `familyId: String(budget.familyId || '')` masks issues
- ⚠️ **No validation** - Missing date range and budget data validation
- ⚠️ **Limited error handling** - Individual period failures not tracked

**Recommendations:**
- Add input validation
- Improve error handling for batch operations
- Use groupIds instead of familyId

---

### budgetSpending.ts - Budget Spending Updates ⭐

**Purpose:** **PRIMARY IMPLEMENTATION** - Updates budget_periods.spent when transactions change

**Status:** Single source of truth (duplicate in `/src/functions/budgets/utils/budgetSpending.ts` was deleted)

**Key Functions:**

#### `updateBudgetSpending(params)`
Main orchestrator for budget spending updates
```typescript
interface UpdateBudgetSpendingParams {
  oldTransaction?: Transaction;    // For updates/deletes
  newTransaction?: Transaction;    // For creates/updates
  userId: string;
  groupId?: string;
}

const result = await updateBudgetSpending({
  oldTransaction: existingTxn,  // undefined for creates
  newTransaction: updatedTxn,   // undefined for deletes
  userId: 'user_123',
  groupId: 'group_456',
});

// Returns:
{
  budgetPeriodsUpdated: 6,
  budgetsAffected: 2,
  periodTypesUpdated: ['monthly', 'bi_monthly', 'weekly'],
}
```

**Logic Flow:**
1. Calculate spending deltas (old → new)
2. Only process APPROVED EXPENSE transactions
3. Query matching budget_periods by date range
4. Update spent/remaining amounts atomically
5. Return comprehensive metrics

**Delta Calculation:**
```typescript
// Creation: Add new spending
oldTransaction = undefined, newTransaction = {...}
→ Delta: +$100

// Update: Calculate difference
oldTransaction = {amount: 100}, newTransaction = {amount: 150}
→ Delta: +$50

// Deletion: Reverse spending
oldTransaction = {amount: 100}, newTransaction = undefined
→ Delta: -$100
```

**Period Assignment:**
- Date-based: Transaction date must fall within period's start/end (inclusive)
- Multi-period: One transaction updates monthly + bi-monthly + weekly periods
- Split-aware: Each split can affect different budget

#### `recalculateBudgetSpendingOnCreate(budgetId, userId, categoryIds, startDate, endDate)`
Recalculate spending for historical data
```typescript
const periodsUpdated = await recalculateBudgetSpendingOnCreate(
  budgetId,
  userId,
  ['food', 'groceries'],
  startDate,
  endDate || null,
);
```

**Use Cases:**
- New budget created with historical date range
- Migration/data fixes
- Manual recalculation

**Performance:**
- Efficient batch operations
- Date-range filtering
- Indexed queries

**Issues Found:**
- ⚠️ **Potential race conditions** - Multiple concurrent updates not atomic
- ⚠️ **No Firestore transactions** - Batch updates aren't wrapped
- ⚠️ **Missing validation** - No check that transaction belongs to budget's user
- ⚠️ **Commented-out budgetName lookup** (line 152)

**Recommendations:**
- Wrap batch operations in Firestore transactions
- Add validation for user ownership
- Consider using FieldValue.increment() for atomic updates
- Re-implement budgetName denormalization

---

### documentStructure.ts - Hybrid Document Builders ⭐

**Purpose:** Build standardized hybrid documents with query-critical fields at root + nested organizational objects

**Architecture:** NEW GroupIds-Based Sharing Model

**Key Builders:**

#### `buildAccessControl(userId, createdBy, groupIds?)`
Creates access control object with groupIds support
```typescript
const access = buildAccessControl('user_123', 'user_123', ['group_456']);

// Returns:
{
  ownerId: 'user_123',
  createdBy: 'user_123',
  groupIds: ['group_456'],  // Empty array = private
  isPrivate: false,
}
```

#### `buildCategories(primary?, secondary?, tags?)`
Creates categories object for transactions/accounts
```typescript
const categories = buildCategories('FOOD_AND_DRINK', 'RESTAURANTS', ['dining', 'takeout']);

// Returns:
{
  primary: 'FOOD_AND_DRINK',
  secondary: 'RESTAURANTS',
  tags: ['dining', 'takeout'],
}
```

#### `buildMetadata(createdBy, source, notes?)`
Creates metadata object
```typescript
const metadata = buildMetadata('user_123', 'plaid', 'Initial sync');

// Returns:
{
  source: 'plaid',  // 'manual', 'plaid', 'import'
  createdBy: 'user_123',
  notes: 'Initial sync',
  lastSyncedAt: null,
}
```

#### `buildRelationships(parentId?, parentType?, linkedIds?)`
Creates relationships object
```typescript
const relationships = buildRelationships('budget_abc', 'budget', []);

// Returns:
{
  parentId: 'budget_abc',
  parentType: 'budget',
  linkedIds: [],
}
```

**Inheritance Functions:**

#### `inheritAccessControl(parent)`
Inherits access from parent document
```typescript
const childAccess = inheritAccessControl(parentBudget.access);
```

#### `inheritMetadata(parent, overrides?)`
Inherits metadata with optional overrides
```typescript
const childMetadata = inheritMetadata(parentBudget.metadata, {
  source: 'derived',
});
```

**Hybrid Document Pattern:**
```typescript
const document = {
  // === ROOT-LEVEL QUERY FIELDS ===
  userId: 'user_123',           // For userId queries
  groupIds: ['group_456'],      // For array-contains queries
  isActive: true,               // For active/inactive filtering
  createdAt: Timestamp.now(),   // For sorting/filtering

  // === NESTED ORGANIZATIONAL OBJECTS ===
  access: buildAccessControl(...),
  categories: buildCategories(...),
  metadata: buildMetadata(...),
  relationships: buildRelationships(...),

  // === RESOURCE-SPECIFIC FIELDS ===
  // ... varies by document type
};
```

**Deprecated Functions Removed:**
- ❌ `calculateAccessibleBy()` - Used denormalized arrays
- ❌ `enhanceWithGroupSharing()` - Old sharing model

**Issues Found:**
- ⚠️ **Legacy field filtering** - inheritAccessControl filters but doesn't validate
- ⚠️ **Type assertion** - inheritMetadata uses assertion instead of proper typing
- ⚠️ **No validation** - Missing groupIds array validation

**Recommendations:**
- Add groupIds validation
- Remove type assertions
- Document query-critical vs organizational fields

**Migration Note:** This is the correct implementation of the NEW groupIds-based sharing model.

---

### encryption.ts - AES-256-GCM Encryption ⭐

**Purpose:** Enterprise-grade encryption for sensitive data (Plaid access tokens)

**Algorithm:** AES-256-GCM with authentication tags

**Key Functions:**

#### `encryptAccessToken(accessToken)`
Encrypt sensitive token for database storage
```typescript
const encrypted = encryptAccessToken('access-sandbox-abc123');

// Returns:
{
  iv: 'base64_encoded_iv',           // Unique per encryption
  encryptedData: 'base64_data',      // Encrypted token
  authTag: 'base64_auth_tag',        // Authentication tag
}
```

**Security Features:**
- Unique initialization vector (IV) per encryption
- Authentication tag prevents tampering
- Base64 encoding for database storage
- Validates Plaid token format (starts with 'access-')

#### `decryptAccessToken(encryptedData)`
Decrypt token for Plaid API calls
```typescript
const plaintext = decryptAccessToken({
  iv: '...',
  encryptedData: '...',
  authTag: '...',
});

// Returns: 'access-sandbox-abc123'
```

**Security Checks:**
- Validates encrypted data structure
- Verifies authentication tag
- Throws on tampered data

#### Migration Functions

**`isTokenEncrypted(token)`** - Check if token is encrypted
```typescript
if (isTokenEncrypted(accessToken)) {
  // Already encrypted
} else {
  // Plain text, needs encryption
}
```

**`migrateToEncryptedToken(plainTextToken)`** - Encrypt plain tokens
```typescript
const encrypted = migrateToEncryptedToken('access-sandbox-abc123');
```

#### Configuration Functions

**`validateEncryptionConfig()`** - Startup validation
```typescript
// Call at startup to verify encryption key configured
validateEncryptionConfig();
```

**`generateEncryptionKey()`** - Generate new 32-byte key
```typescript
const key = generateEncryptionKey();
// Returns 64-character hex string
```

**Environment Setup:**
```typescript
// In firebase.json:
{
  "functions": {
    "source": ".",
    "params": {
      "TOKEN_ENCRYPTION_KEY": {
        "type": "secret"
      }
    }
  }
}

// Set secret:
firebase functions:secrets:set TOKEN_ENCRYPTION_KEY
```

**Key Formats Supported:**
- Hex (64 characters) - Recommended
- Base64 (44 characters)
- UTF-8 (32 bytes)

**Security Assessment:** ⭐⭐⭐⭐⭐ Excellent
- Industry-standard AES-256-GCM
- Proper IV and auth tag handling
- Validates token format
- Safe base64 encoding

**Issues Found:**
- ⚠️ **No key rotation** - No support for rotating encryption keys
- ⚠️ **No key versioning** - Can't migrate to new keys
- ⚠️ **Error exposure** - Some messages might leak info
- ⚠️ **No rate limiting** - No protection against brute force

**Recommendations:**
- Implement key rotation strategy
- Add key versioning to encrypted data
- Sanitize error messages
- Add decryption rate limiting
- Add encryption metrics/monitoring

---

### firestore.ts - Generic Firestore CRUD

**Purpose:** Type-safe generic database operations

**Key Functions:**

#### CRUD Operations

**`createDocument<T>(collection, data)`**
```typescript
const docId = await createDocument<Transaction>('transactions', {
  amount: 100,
  // ... auto-adds createdAt, updatedAt
});
```

**`getDocument<T>(collection, docId)`**
```typescript
const transaction = await getDocument<Transaction>('transactions', 'txn_123');
```

**`updateDocument<T>(collection, docId, data)`**
```typescript
await updateDocument<Transaction>('transactions', 'txn_123', {
  amount: 150,
  // ... auto-updates updatedAt
});
```

**`deleteDocument(collection, docId)`**
```typescript
await deleteDocument('transactions', 'txn_123');
```

#### Query Operations

**`queryDocuments<T>(collection, options)`**
```typescript
interface QueryOptions {
  where?: WhereClause[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

const transactions = await queryDocuments<Transaction>('transactions', {
  where: [
    { field: 'ownerId', operator: '==', value: 'user_123' },
    { field: 'isActive', operator: '==', value: true },
  ],
  orderBy: { field: 'transactionDate', direction: 'desc' },
  limit: 50,
});
```

#### Batch Operations

**`batchWrite(operations)`**
```typescript
await batchWrite([
  { type: 'create', collection: 'transactions', data: {...} },
  { type: 'update', collection: 'budgets', docId: 'budget_123', data: {...} },
  { type: 'delete', collection: 'old_data', docId: 'doc_456' },
]);
```

#### Real-time Listeners

**`listenToDocument<T>(collection, docId, callback)`**
```typescript
const unsubscribe = listenToDocument<Transaction>(
  'transactions',
  'txn_123',
  (transaction) => {
    console.log('Updated:', transaction);
  }
);

// Cleanup when done
unsubscribe();
```

**Issues Found:**
- ❌ **No error handling** - Most functions lack try-catch
- ❌ **No validation** - Collection names and doc IDs not validated
- ❌ **Query limitations** - No compound queries or subcollections support
- ❌ **Memory leaks risk** - Listener cleanup not enforced
- ❌ **Inefficient pagination** - Uses offset (slow for large datasets)
- ❌ **Missing FieldValue** - No support for increment, arrayUnion, etc.

**Recommendations:**
- Add comprehensive error handling
- Add input validation
- Support cursor-based pagination
- Add FieldValue operations support
- Document listener cleanup patterns
- Add transaction retry logic

---

### plaidAccounts.ts - Plaid Account Management

**Purpose:** Fetch account data from Plaid and save to Firestore

**Key Functions:**

#### `fetchPlaidAccounts(accessToken)`
Retrieve account details from Plaid API
```typescript
const accounts = await fetchPlaidAccounts(encryptedAccessToken);

// Returns ProcessedAccount[]
interface ProcessedAccount {
  accountId: string;
  name: string;
  type: string;
  subtype: string | null;
  mask: string | null;
  currentBalance: number;  // FIXED: was 'balance'
  availableBalance: number | null;
  isoCurrencyCode: string;
  officialName: string | null;
  limit: number | null;
}
```

#### `savePlaidItem(db, userId, itemId, institutionId, institutionName, accessToken, groupId?)`
Save Plaid item with encrypted access token
```typescript
await savePlaidItem(
  db,
  'user_123',
  'item_abc',
  'ins_123',
  'Chase',
  encryptedToken,
  'group_456'  // Optional
);
```

**Security:** Encrypts access token before storage

#### `savePlaidAccounts(db, userId, itemId, accounts, groupId?)`
Save account documents using hybrid structure
```typescript
await savePlaidAccounts(
  db,
  'user_123',
  'item_abc',
  accounts,
  'group_456'
);
```

**Uses documentStructure builders:**
- `buildAccessControl()` for groupIds support
- `buildMetadata()` for tracking
- `buildRelationships()` for linking

**Recent Fix (Oct 3, 2025):**
Line 180 corrected to save `currentBalance` instead of deprecated `balance` field.

**Issues Found:**
- ⚠️ **TODO comment** (line 89) - familyId from userData not implemented
- ⚠️ **Empty familyId** - Sets `familyId: ''` which is inconsistent
- ⚠️ **Limited error handling** - Individual account save failures not isolated
- ⚠️ **No retry logic** - Network failures not retried

**Recommendations:**
- Remove or implement familyId TODO
- Add Plaid API retry logic
- Improve error isolation
- Add account sync status tracking

---

### plaidClient.ts - Basic Plaid Client (Legacy)

**Purpose:** Create configured Plaid API client

**Status:** Legacy - consider using plaidClientFactory.ts instead

**Key Functions:**

#### `createPlaidClient()`
Create basic Plaid API client
```typescript
const client = createPlaidClient();
```

**Hardcoded:** Always uses sandbox environment

#### `exchangePublicToken(publicToken)`
Exchange public token for access token
```typescript
const accessToken = await exchangePublicToken(publicToken);
```

**Issues Found:**
- ⚠️ **Hardcoded sandbox** - No environment configuration
- ⚠️ **No configuration options** - Timeout, retry, etc. not customizable
- ⚠️ **Limited functionality** - Only token exchange
- ⚠️ **Duplicate code** - Overlaps with plaidClientFactory.ts

**Recommendations:**
- Deprecate in favor of plaidClientFactory.ts
- Or enhance to match factory capabilities

---

### plaidClientFactory.ts - Advanced Plaid Client ⭐

**Purpose:** Centralized Plaid client with retry logic and error handling

**Key Functions:**

#### `createStandardPlaidClient()`
Create Plaid client with standard configuration
```typescript
const client = createStandardPlaidClient();
```

**Features:**
- Environment-based configuration (sandbox/development/production)
- Validates Plaid credentials at startup
- Proper error handling

#### `withRetry<T>(operation, maxRetries?)`
Execute Plaid operation with exponential backoff
```typescript
const result = await withRetry(async (client) => {
  return await client.accountsGet(request);
}, 3); // Max 3 retries
```

**Retry Strategy:**
- Exponential backoff: 1s, 2s, 4s, 8s...
- Random jitter up to 1000ms
- Retries on network errors, 5xx errors, 429 rate limits
- Stops on 4xx client errors (except 429)

#### `executeWithRetry(client, method, request, maxRetries?)`
Generic Plaid method executor with retry
```typescript
const result = await executeWithRetry(
  client,
  'transactionsGet',
  request,
  3
);

// Returns:
{
  success: boolean;
  data?: any;
  error?: Error;
  attempts: number;
}
```

**Retryable Errors:**
- Network errors (ECONNRESET, ETIMEDOUT)
- 5xx server errors
- 429 rate limit errors
- Socket hang up

**Non-Retryable Errors:**
- 4xx client errors (except 429)
- Invalid credentials
- Malformed requests

**Configuration:**
```typescript
interface RetryConfig {
  maxRetries: number;        // Default: 3
  initialDelayMs: number;    // Default: 1000
  maxDelayMs: number;        // Default: 32000
}
```

**Issues Found:**
- ⚠️ **Overlaps with plaidClient.ts** - Should consolidate
- ⚠️ **No circuit breaker** - No protection against repeated failures
- ⚠️ **High jitter** - Up to 1000ms might be excessive
- ⚠️ **No metrics** - No instrumentation for monitoring
- ⚠️ **Type safety** - Method validation not fully type-safe

**Recommendations:**
- Consolidate with plaidClient.ts
- Add circuit breaker pattern
- Add metrics/monitoring
- Adjust jitter range
- Improve type safety

---

### plaidRecurring.ts - Recurring Transaction Streams

**Purpose:** Process recurring income (inflows) and expense (outflows) from Plaid

**Key Functions:**

#### `processRecurringTransactions(plaidItem, accessToken)`
Fetch and process recurring streams
```typescript
const result = await processRecurringTransactions(plaidItem, accessToken);

// Returns:
{
  inflowsProcessed: 5,
  outflowsProcessed: 12,
  errors: [],
}
```

**Process:**
1. Decrypt access token
2. Call Plaid `/transactions/recurring/get` API
3. Split into inflow_streams and outflow_streams
4. Save to `inflows` and `outflows` collections
5. Return counts and errors

**Issues Found:**
- ❌ **Deprecated structure** - Uses flat structure instead of hybrid
- ❌ **TODO comments** - familyId not implemented (lines 89, 173)
- ❌ **No groupIds support** - Missing new sharing model
- ❌ **Empty familyId** - Sets `familyId: ''`
- ❌ **No upsert logic** - Always overwrites existing streams
- ❌ **No validation** - Missing stream data validation
- ❌ **Type safety** - Uses `any[]` instead of proper interfaces

**Recommendations:**
- **HIGH PRIORITY:** Update to hybrid structure using documentStructure.ts
- Add groupIds support
- Implement upsert logic (merge with existing)
- Create proper TypeScript interfaces
- Add validation
- Remove or implement familyId TODOs

---

### validation.ts - Request & Business Validation

**Purpose:** Comprehensive validation schemas and utilities

**Key Schemas:**

#### Transaction Schemas
```typescript
const createTransactionSchema = Joi.object({
  amount: Joi.number().required().positive(),
  description: Joi.string().required().min(1).max(500),
  transactionDate: Joi.date().iso().required(),
  accountId: Joi.string().required(),
  categoryId: Joi.string().required(),
  splits: Joi.array().items(splitSchema).optional(),
});
```

#### Budget Schemas
```typescript
const createBudgetSchema = Joi.object({
  name: Joi.string().required().min(1).max(100),
  amount: Joi.number().required().positive(),
  period: Joi.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'),
  categoryIds: Joi.array().items(Joi.string()).min(1),
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().when('isOngoing', {
    is: false,
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
});
```

**Validation Functions:**

#### `validateRequest(data, schema)`
Validate request data against schema
```typescript
const result = validateRequest(requestData, createTransactionSchema);

if (!result.valid) {
  throw new HttpsError('invalid-argument', result.error);
}
```

#### `validateCategoryIds(categoryIds, db)`
Validate categories exist in Firestore
```typescript
const valid = await validateCategoryIds(['food', 'dining'], db);
```

#### `validateUserPermissions(userId, requiredRole, db)`
Check user has required role
```typescript
const hasPermission = await validateUserPermissions(
  'user_123',
  UserRole.EDITOR,
  db
);
```

#### `validateBudgetLimit(userId, db)`
Check if user can create more budgets
```typescript
const canCreate = await validateBudgetLimit('user_123', db);
```

#### `validateTransactionPermission(transaction, userId)`
Check if user can modify transaction
```typescript
const canModify = await validateTransactionPermission(txn, 'user_123');
```

**Issues Found:**
- ⚠️ **Legacy role system** - Uses old UserRole instead of RBAC
- ⚠️ **Family-centric** - Validation assumes family model
- ⚠️ **Performance** - validateCategoryIds makes individual DB calls
- ⚠️ **Missing validation** - No groupIds validation
- ⚠️ **No rate limiting** - Expensive validations could be abused

**Recommendations:**
- Update to new RBAC system
- Add groupIds validation schemas
- Optimize validateCategoryIds with batch queries
- Add group-based permission validation
- Add rate limiting

---

## Cross-Cutting Concerns

### Migration to Group-Based Sharing

**Status:** Partially Complete

**Files by Status:**
- ✅ **Complete:** documentStructure.ts (deprecated functions removed)
- ✅ **Complete:** plaidAccounts.ts (uses groupIds correctly)
- ⚠️ **Partial:** auth.ts (still family-centric)
- ❌ **Not Started:** plaidRecurring.ts (missing groupIds)
- ❌ **Not Started:** validation.ts (family-based permissions)

**Action Required:**
1. Update auth.ts to support groupIds permission checks
2. Migrate plaidRecurring.ts to hybrid structure with groupIds
3. Update validation.ts schemas and permission checks

---

### Error Handling Patterns

**Current State:** Inconsistent

**Best Practices:**
- encryption.ts, plaidClientFactory.ts: Comprehensive try-catch
- firestore.ts, budgetPeriods.ts: Minimal error handling

**Recommendation:**
Establish standard error handling pattern:
```typescript
try {
  // Operation
  return result;
} catch (error) {
  console.error('[FunctionName] Error:', error);

  if (error instanceof PlaidError) {
    throw new HttpsError('internal', `Plaid error: ${error.message}`);
  }

  throw new HttpsError('internal', 'Operation failed');
}
```

---

### TypeScript Type Safety

**Overall Quality:** Very Good

**Issues:**
- Some `any` types (firestore.ts batch operations, plaidRecurring.ts)
- Type assertions instead of proper typing (documentStructure.ts)
- Missing interfaces for complex structures

**Recommendation:**
- Create proper interfaces for all data structures
- Eliminate remaining `any` types
- Use type guards instead of assertions

---

### Logging Standards

**Current State:** Inconsistent

**Patterns Found:**
- budgetSpending.ts: Emojis (💰, 📊, ✅, ❌, ⚠️)
- Most files: Plain console.log/error
- Varying detail levels

**Recommendation:**
Establish logging standard:
```typescript
// Format: [FunctionName] Level: Message
console.log('[updateBudgetSpending] ✅ Successfully updated 3 periods');
console.error('[updateBudgetSpending] ❌ Error:', error);
console.warn('[validateBudgetIds] ⚠️ Invalid budget ID: budget_abc');
```

---

### Security Considerations

**Strong Security:**
- ✅ encryption.ts: Enterprise-grade AES-256-GCM
- ✅ plaidAccounts.ts: Properly encrypts tokens
- ✅ auth.ts: Token verification and role checks

**Security Gaps:**
- ❌ CORS allows all localhost (auth.ts)
- ❌ No rate limiting on expensive operations
- ❌ Error messages might leak sensitive info
- ❌ No audit logging for sensitive operations

**Recommendations:**
1. Tighten CORS validation
2. Add rate limiting (especially for validation, encryption)
3. Sanitize error messages
4. Add audit logging for:
   - Token decryption
   - Permission failures
   - Sensitive data access

---

## Best Practices

### When to Use Each Utility

**Authentication:**
- Use `auth.ts` for all authentication needs
- Use `authMiddleware()` for HTTP endpoints
- Use `authenticateRequest()` for callable functions

**Database Operations:**
- Use `firestore.ts` for generic CRUD
- Use `budgetSpending.ts` for budget calculations
- Use `budgetPeriods.ts` for period management

**Plaid Integration:**
- Use `plaidClientFactory.ts` for all Plaid operations (preferred)
- Use `plaidAccounts.ts` for account data fetching
- Use `encryption.ts` for token encryption/decryption
- Avoid `plaidClient.ts` (legacy)

**Data Structure:**
- Always use `documentStructure.ts` builders for new documents
- Use `buildAccessControl()` with groupIds for sharing
- Use hybrid pattern (query fields at root, nested objects)

**Validation:**
- Use `validation.ts` schemas for all user input
- Validate categoryIds against Firestore
- Check permissions before mutations

---

## Dependencies Graph

```
auth.ts
├── firestore.ts (getDocument)
└── types/index.ts

budgetPeriods.ts
├── firebase-admin
├── types/index.ts
└── functions/budgets/utils/calculatePeriodAllocatedAmount

budgetSpending.ts (PRIMARY)
├── firebase-admin
├── index.ts (db)
└── types/index.ts

documentStructure.ts ⭐
├── firebase-admin
└── types/index.ts

encryption.ts ⭐
├── Node.js crypto
└── firebase-functions/params

firestore.ts
├── firebase-admin
└── types/index.ts

plaidAccounts.ts
├── Plaid SDK
├── firebase-admin
├── index.ts (db)
├── encryption.ts ⭐
└── documentStructure.ts ⭐

plaidClient.ts (legacy)
└── Plaid SDK

plaidClientFactory.ts ⭐
├── Plaid SDK
├── firebase-functions/params
└── plaidClient.ts

plaidRecurring.ts
├── Plaid SDK
├── firebase-admin
└── index.ts (db)

validation.ts
├── Joi
├── firebase-admin
└── types/index.ts
```

⭐ = Recommended for new code

---

## Priority Recommendations

### High Priority (Security & Data Integrity)

1. **Complete Group-Based Sharing Migration**
   - Update auth.ts, plaidRecurring.ts, validation.ts
   - Add groupIds support across all utilities

2. **Add Firestore Transaction Support**
   - Wrap critical operations in transactions (budgetSpending.ts)
   - Prevent race conditions

3. **Tighten Security**
   - Fix CORS validation in auth.ts
   - Add rate limiting on expensive operations
   - Add audit logging

4. **Migrate plaidRecurring.ts**
   - Update to hybrid document structure
   - Add groupIds support
   - Implement upsert logic

### Medium Priority (Performance & Maintenance)

5. **Consolidate Plaid Utilities**
   - Deprecate plaidClient.ts
   - Use plaidClientFactory.ts as standard

6. **Error Handling Standardization**
   - Establish patterns across all utilities
   - Add retry logic where appropriate

7. **Optimize Database Queries**
   - Add cursor-based pagination to firestore.ts
   - Batch category validation in validation.ts
   - Add FieldValue support

### Low Priority (Code Quality)

8. **TypeScript Improvements**
   - Eliminate remaining `any` types
   - Add missing interfaces
   - Remove type assertions

9. **Logging Standards**
   - Establish consistent format
   - Add structured logging

10. **Documentation**
    - Add JSDoc comments to all public functions
    - Document migration paths

---

## Testing

### Current Test Coverage

**Existing Tests:**
- `__tests__/encryption.test.ts`
- `__tests__/plaidClientFactory.test.ts`

**Missing Tests:**
- budgetSpending.ts (critical calculations)
- validation.ts (complex business logic)
- documentStructure.ts (data integrity)
- budgetPeriods.ts (period generation)

**Recommendation:**
Add comprehensive unit tests for:
1. encryption.ts (security-critical)
2. budgetSpending.ts (complex calculations)
3. validation.ts (business logic)
4. documentStructure.ts (data structures)

---

## Migration Guide

### From Legacy to New Systems

**RBAC Migration:**
```typescript
// Old:
const role = user.role; // UserRole enum

// New:
const systemRole = user.systemRole;  // SystemRole
const groupRole = user.groupRoles[groupId];  // GroupRole per group
```

**Sharing Model Migration:**
```typescript
// Old:
const familyId = budget.familyId;
const accessibleBy = budget.accessibleBy;

// New:
const groupIds = budget.groupIds;  // Array
const access = budget.access;       // AccessControl object
```

**Document Structure Migration:**
```typescript
// Old:
const doc = {
  userId: '...',
  familyId: '...',
  // ... all fields flat
};

// New:
const doc = {
  // Query-critical at root
  userId: '...',
  groupIds: ['...'],
  isActive: true,

  // Organized in nested objects
  access: buildAccessControl(...),
  categories: buildCategories(...),
  metadata: buildMetadata(...),
  relationships: buildRelationships(...),
};
```

---

## Notes for AI Assistants

- **documentStructure.ts is the standard** - Always use builders for new documents
- **budgetSpending.ts in /src/utils is PRIMARY** - Don't use functions/budgets/utils version (deleted)
- **plaidClientFactory.ts is preferred** - Use instead of plaidClient.ts
- **encryption.ts is production-grade** - Don't modify crypto logic without security review
- **groupIds is the new standard** - Array-based sharing, not familyId
- **Hybrid document structure** - Query fields at root, organizational fields nested
- **Test with emulators** - Always test utilities locally before deploying
- **Security is critical** - Encryption, auth, validation are security-sensitive
