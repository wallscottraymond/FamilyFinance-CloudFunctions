# Cloud Functions Layered Architecture

> **The definitive guide for implementing Cloud Functions in FamilyFinance**

## Quick Reference

```
Entry → Orchestrator → Resolver → Domain → Repository → Firestore
```

**Before implementing ANY function, read this entire document.**

---

## Naming Conventions (ENFORCED BY ESLINT)

All code in the new architecture folders uses **snake_case**. This is enforced by ESLint.

| Element | Convention | Example |
|---------|------------|---------|
| Variables | snake_case | `user_id`, `trace_context`, `affected_entities` |
| Functions | snake_case | `create_transaction()`, `compute_budget()` |
| Parameters | snake_case | `function process(input_data, user_id)` |
| Properties | snake_case | `{ trace_id: "...", span_id: "..." }` |
| Constants | UPPER_CASE | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| Types/Interfaces | PascalCase | `TraceContext`, `DomainResult`, `WriteResult` |
| Enums | PascalCase | `RecomputationScope` |
| Enum members | UPPER_CASE | `NONE`, `SINGLE`, `BATCH`, `FULL` |

**File naming:** snake_case with descriptive suffixes
```
transaction.repo.ts
budget.service.ts
create_transaction.orchestrator.ts
create_transaction.entry.ts
transaction.resolver.ts
```

**Why snake_case?**
- Easier to read (especially for compound names)
- Clear word boundaries
- Consistent with the type definitions
- All existing code will migrate to this structure

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Layer Definitions](#2-layer-definitions)
   - Entry: Execution characteristics, mental model
   - Orchestrator: Control vs domain logic, performance budgets
   - Resolver: Lookup vs logic test, split handling, verification test
   - Domain: Time handling, composition, no logging
   - Repository: Idempotent writes, conditional logic rule, transaction rule
   - Integration: Client (API calls) + Transformer (pure conversion)
3. [Type System](#3-type-system)
   - 3.1-3.7: Core Types
   - 3.8: Error Types
   - 3.9: Input Validation (Zod)
   - 3.10: Function Patterns (Triggers, Scheduled, Queries, Deletes)
   - 3.11: Cloud Tasks Setup
   - 3.12: Event Handler Rules
4. [Dependency Definitions](#4-dependency-definitions)
   - Invalidation model (invalidation-based, not mutation-based)
5. [Implementation Process](#5-implementation-process)
6. [Layer Templates](#6-layer-templates)
7. [Edge Case Handling](#7-edge-case-handling)
8. [Testing Requirements](#8-testing-requirements)
9. [Checklist](#9-checklist)
10. [Observability Constraints](#observability-constraints)
11. [Robustness Infrastructure](#robustness-infrastructure)
    - Circuit Breaker, Health Check, Audit Trail
    - Feature Flags, Graceful Degradation
    - Timeout Wrapper, Rate Limiting
12. [Configuration Management](#12-configuration-management)
    - Config hierarchy, runtime config access
13. [Operational Requirements](#13-operational-requirements)
    - Monitoring, load testing, emergency rollback

---

## 1. Architecture Overview

### 1.1 The Five Layers

| Layer | Location | Responsibility | Can Call |
|-------|----------|----------------|----------|
| **Entry** | `/src/functions/entry/` | Protocol adapter (HTTP → internal) | Orchestrator (exactly ONE) |
| **Orchestrator** | `/src/functions/orchestrators/` | Workflow coordination | Resolver, Domain, Repository, EventBus, JobQueue |
| **Resolver** | `/src/functions/resolvers/` | Impact analysis (read-only) | Repository (reads only) |
| **Domain** | `/src/functions/domain/` | Pure business logic | Other Domain services (pure only) |
| **Repository** | `/src/functions/repositories/` | Persistence | Firestore |

### 1.2 Global Invariants (NEVER VIOLATE)

```
1. NO LAYER SKIPPING - EVER
   Entry → Orchestrator → Resolver → Domain → Repository
   EVERY operation MUST call ALL layers, even trivial ones.

2. ONE RESPONSIBILITY PER LAYER
   If a function does two things → SPLIT IT

3. ALL SIDE EFFECTS EXPLICIT
   No hidden mutations, all writes go through repositories

4. ALL WORKFLOWS TRACEABLE
   Every operation carries trace_id through all layers

5. ALL WRITES THROUGH REPOSITORIES
   No direct Firestore access outside repo layer

6. ALL BUSINESS LOGIC IN DOMAIN SERVICES
   Pure, testable, deterministic
```

### 1.3 NO LAYER SKIPPING - Detailed (CRITICAL)

**Every orchestrator MUST call Resolver, Domain Service, and Repository in that order.**

This rule exists for:
- **Consistency** - Every operation follows the same pattern
- **Auditability** - Traces show the full path through all layers
- **Extensibility** - Adding logic later doesn't require restructuring
- **Testability** - Each layer can be tested in isolation

**What about trivial operations?**

Even when a layer has "nothing to do", it MUST still be called with a passthrough implementation:

#### Trivial Resolver (no dependencies to analyze)
```typescript
// resolvers/account.resolver.ts
export async function resolve_link_accounts_dependencies(
  ctx: TraceContext,
  input: LinkAccountsInput
): Promise<DependencyResult> {
  // No dependencies to analyze for new account creation
  return no_dependencies();
}
```

#### Trivial Domain Service (no business logic)
```typescript
// domain/account.service.ts
export function validate_accounts_for_linking(
  accounts: AccountForPersistence[]
): DomainResult<AccountForPersistence[]> {
  // No additional business rules - accounts are valid as transformed
  return { entities: accounts };
}
```

#### Why not skip?

```typescript
// ❌ WRONG - Skipping resolver because "there are no dependencies"
async function create_account_orchestrator(ctx, input) {
  // const deps = await resolve_dependencies(ctx, input);  // SKIPPED!
  const domain = compute_account(input);
  await account_repo.save(domain);
}

// ✅ CORRECT - Always call all layers
async function create_account_orchestrator(ctx, input) {
  const deps = await resolve_dependencies(ctx, input);     // Called even if trivial
  const domain = validate_for_creation(input);             // Called even if trivial
  await account_repo.save(domain);
}
```

**The moment you skip a layer "because it's trivial", you create:**
- Inconsistent patterns across the codebase
- Difficulty adding logic later (requires restructuring)
- Broken traces missing expected spans
- Confusion about when skipping is "allowed"

**Rule: If you think a layer can be skipped, create a passthrough implementation instead.**

### 1.4 The Split Rule

If any function:
- reads + computes → **SPLIT**
- computes + writes → **SPLIT**
- filters + validates → **SPLIT**

---

## 2. Layer Definitions

### 2.1 Entry Layer

**Purpose:** Translate external requests into internal system calls.

**MUST do:**
- Validate input (schema, required fields, types)
- Extract authenticated user identity
- Create root trace context
- Normalize payload to internal format
- Call exactly ONE orchestrator
- Map orchestrator response to client response

**MUST NOT do:**
- Contain business logic
- Access data/repositories
- Call multiple orchestrators
- Make workflow decisions
- Generate fallback idempotency keys

**Execution Model:**
```
Incoming Request
    ↓
Validate Input
    ↓
Authenticate User
    ↓
Create Trace Context
    ↓
Normalize Payload
    ↓
Call Orchestrator (exactly one)
    ↓
Return Response
```

**Execution Characteristics:**
- **O(1) time** relative to input size (no loops over system data)
- **Stateless** - no persistent state between calls
- **Deterministic** - same input = same behavior
- **Short-lived** - execute quickly, don't block
- **Fail-fast** - reject invalid input immediately

**Mental Model:** If you removed all Entry Functions and replaced them with `HTTP → Orchestrator`, the system behavior should remain identical.

---

### 2.2 Orchestrator Layer

**Purpose:** Coordinate workflow execution with idempotency guarantees.

**MUST do:**
1. Create child span from trace context
2. Check idempotency (return cached if duplicate)
3. Call resolver for dependency analysis
4. Call domain service for computation
5. Call repository for persistence
6. Emit events (facts about what happened)
7. Enqueue jobs (async work)
8. Track performance budget
9. Log asynchronously

**MUST NOT do:**
- Compute business values
- Interpret domain meaning
- Access Firestore directly
- Modify domain service output

**Execution Model:**
```
Start
    ↓
Idempotency Check → (if duplicate) → Return Cached
    ↓
Dependency Resolution
    ↓
Domain Service Execution
    ↓
Persistence (Repositories)
    ↓
Event Emission
    ↓
Job Scheduling
    ↓
Async Logging
    ↓
Return Result
```

**Performance Budget:**
```typescript
// Each orchestrator defines its limits
const BUDGET = {
  max_reads: 25,    // Firestore read operations
  max_writes: 10,   // Firestore write operations
  max_time_ms: 500  // Total execution time
};
```

**Control Logic vs Domain Logic (Critical Distinction):**

Orchestrators MAY contain **control flow logic**, but MUST NOT contain **domain logic**.

```typescript
// ✅ ALLOWED: Control flow logic
if (dependencies.recomputation_scope !== "none") {
  await job_queue.enqueue({ type: "recompute_budgets", ... });
}

// ❌ FORBIDDEN: Domain logic
if (transaction.amount > budget.limit) { ... }
```

**Mental Model:** If you replaced all domain services with `return MOCK_RESULT`, the orchestrator should still:
- call everything in the same order
- emit the same events
- schedule the same jobs

---

### 2.3 Resolver Layer

**Purpose:** Determine what entities are affected by a change (read-only impact analysis).

**MUST do:**
- Fetch relevant data via repositories (READ ONLY)
- Filter by field matching (category === category)
- Map to entity IDs
- Deduplicate (Set)
- Classify recomputation scope

**MUST NOT do:**
- Perform business logic
- Validate financial correctness
- Mutate any state
- Emit events or trigger jobs

**The Lookup vs Logic Test:**
```
ASK: "Am I comparing values or interpreting meaning?"

✅ Comparing fields (lookup):
   budget.category === split.category

❌ Interpreting meaning (logic):
   budget.remaining < split.amount
```

**Execution Model:**
```
Input
    ↓
Fetch Relevant Data (repositories)
    ↓
Filter (match relationships)
    ↓
Map (extract IDs)
    ↓
Union (deduplicate)
    ↓
Classify Scope
    ↓
Return Result
```

**Split Handling Rule (Critical):**
Each split MUST be treated independently:
```typescript
for (const split of ctx.input.splits) {
  const matching = budgets.filter(b => b.category === split.category);
  matching.forEach(b => affected_set.add(b.id));
}
// union all results
const affected = Array.from(affected_set);
```

**Mental Model:** Dependency Resolver = SQL query engine, not application logic.

It answers: "Which rows are related?"
NOT: "What do those rows mean?"

**Verification Test:** If you replaced all numbers with random values, the resolver output should NOT change (as long as relationships stay the same).

---

### 2.4 Domain Layer

**Purpose:** Pure, deterministic business logic computation.

**MUST do:**
- Validate business rules
- Compute derived values
- Transform data structures
- Return structured results (not throw)

**MUST NOT do:**
- Perform IO (`await` = WRONG)
- Import repositories
- Access external state
- Emit events
- Depend on execution context

**Hard Rules:**
```
1. If the function contains `await` → NOT a domain service
2. If the function imports a repository → WRONG
3. If output depends on anything outside input → INVALID
```

**Time Handling Rule:**
```typescript
// ✅ ALLOWED: Injected deterministic helper
const timestamp = now(); // Inject or pass as parameter

// ❌ FORBIDDEN: Direct call (non-deterministic)
const timestamp = Date.now();
```

**Domain Service Composition:**
Domain services MAY call other domain services ONLY if:
- both are pure
- no side effects
- no hidden dependencies

```typescript
const totals = compute_totals(input);
const allocations = compute_allocations(input);
return merge_results(totals, allocations);
```

**Execution Model:**
```
Input (plain objects)
    ↓
Validation (pure, deterministic)
    ↓
Computation
    ↓
Domain Rule Enforcement
    ↓
Return DomainResult<T>
```

**No Logging Rule:** Domain services MUST NOT log (they are pure functions).

---

### 2.5 Repository Layer

**Purpose:** Persistence boundary - store and retrieve domain data.

**MUST do:**
- Accept fully computed domain entities
- Perform structural validation (missing ID, etc.)
- Write using Firestore batch/transaction (ATOMIC)
- Return WriteResult metadata
- Map between domain and Firestore formats

**MUST NOT do:**
- Contain business logic
- Perform calculations
- Trigger workflows
- Emit events
- Write across aggregate boundaries

**Aggregate Boundary Rule:**
```
✅ VALID: transaction + splits (splits belong to transaction)
❌ INVALID: transaction + budget (independent entities)
```

**Write Modes:**
```
replace     → full overwrite (default)
append      → logs, events, immutable history (append-only)
merge       → metadata updates only
```

**Idempotent Write Rule:**
```typescript
// ✅ SAFE (idempotent): Same input → same stored result
batch.set(doc_ref, entity);

// ❌ NOT SAFE: Non-idempotent operations
doc_ref.update({ count: FieldValue.increment(1) }); // increment counter
doc_ref.update({ items: FieldValue.arrayUnion(item) }); // push array blindly
```

**Conditional Logic Rule:**
> If a repository contains an `if` that changes behavior based on business meaning → it is WRONG.

```typescript
// ❌ FORBIDDEN: Business logic in repository
if (entity.type === "income") { doSomethingDifferent(); }
if (budget.limit < spending) { throw error; }

// ✅ ALLOWED: Structural validation only
if (!entity.id) { throw new Error("Missing ID"); }
```

**Firestore Transaction Rule:**
Use Firestore transactions ONLY for:
- Enforcing write consistency within ONE aggregate
- Preventing race conditions on same entity

NOT for:
- Cross-entity workflows (use Orchestrator)
- Orchestration logic

---

### 2.6 Integration Layer

**Purpose:** Interface with external services (Plaid, payment processors, etc.)

The integration layer has two components:
1. **Client** - Makes API calls, handles auth/retries (like Repository but for external APIs)
2. **Transformer** - Converts external format to domain format (PURE, like Domain Service)

**Folder Structure:**
```
/src/functions/integrations
  /plaid
    plaid_client.ts        # API calls, retries, auth
    plaid_transformer.ts   # Plaid → Domain format (PURE)
    plaid_encryption.ts    # Token encryption/decryption
    plaid_webhook.types.ts # Webhook payload types
    plaid.types.ts         # Plaid-specific types
```

#### Integration Client

**MUST do:**
- Call external APIs
- Handle authentication (API keys, tokens)
- Implement retry logic with exponential backoff
- Encrypt/decrypt sensitive tokens
- Return **RAW SDK types** from the external service (e.g., Plaid's `AccountBase`, not a custom mapped type)

**MUST NOT do:**
- Contain business logic
- Interpret the meaning of data
- Transform or map data (that's the Transformer's job)
- Create custom intermediate types
- Write to Firestore

**Critical: Raw Types Only**
```typescript
// ❌ WRONG - Client maps to custom type
async function fetch_accounts(token: string): Promise<MyAccountData[]> {
  const response = await plaid.accountsGet({ access_token: token });
  return response.data.accounts.map(a => ({  // NO! Don't map here
    account_id: a.account_id,
    name: a.name,
  }));
}

// ✅ CORRECT - Client returns raw SDK type
async function fetch_accounts(token: string): Promise<AccountBase[]> {
  const response = await plaid.accountsGet({ access_token: token });
  return response.data.accounts;  // Return raw Plaid SDK type
}
```

**Client Template:**
```typescript
// /src/functions/integrations/plaid/plaid_client.ts

import { with_retry } from "../infrastructure/retry";
import { plaid_encryption } from "./plaid_encryption";

export const plaid_client = {
  async get_transactions(
    encrypted_access_token: string,
    start_date: string,
    end_date: string
  ): Promise<PlaidTransaction[]> {
    // Decrypt token
    const access_token = await plaid_encryption.decrypt(encrypted_access_token);

    // Call API with retry logic
    return with_retry(
      async () => {
        const response = await plaid_api.transactionsGet({
          access_token,
          start_date,
          end_date,
        });
        return response.data.transactions;
      },
      { max_attempts: 3, backoff: "exponential" }
    );
  },

  async exchange_public_token(public_token: string): Promise<string> {
    const response = await plaid_api.itemPublicTokenExchange({ public_token });
    // Encrypt before returning for storage
    return plaid_encryption.encrypt(response.data.access_token);
  },
};
```

#### Integration Transformer

**MUST do:**
- Convert external data format to domain format
- Be PURE (no IO, no side effects)
- Return `DomainResult<T>` with validation errors
- Be unit testable without mocks

**MUST NOT do:**
- Make API calls
- Access Firestore
- Have side effects
- Use `await`

**Transformer Template:**
```typescript
// /src/functions/integrations/plaid/plaid_transformer.ts

/**
 * PURE FUNCTION - no IO, no side effects, deterministic
 */
export function plaid_transactions_to_domain(
  plaid_transactions: PlaidTransaction[],
  account_id: string,
  user_id: string
): DomainResult<Transaction[]> {
  const validation_errors: string[] = [];
  const entities: Transaction[] = [];

  for (const pt of plaid_transactions) {
    if (!pt.transaction_id) {
      validation_errors.push("Missing transaction_id");
      continue;
    }

    entities.push({
      id: `plaid_${pt.transaction_id}`,
      account_id,
      user_id,
      amount: pt.amount,
      date: pt.date,
      description: pt.name || pt.merchant_name || "Unknown",
      category: map_plaid_category(pt.category),
      source: "plaid",
      external_id: pt.transaction_id,
    });
  }

  return validation_errors.length > 0
    ? { entities, validation_errors }
    : { entities };
}

// Also pure
function map_plaid_category(plaid_categories: string[] | null): string {
  if (!plaid_categories?.length) return "uncategorized";
  // Map Plaid category hierarchy to our categories
  const [primary] = plaid_categories;
  const category_map: Record<string, string> = {
    "Food and Drink": "food",
    "Travel": "travel",
    "Shops": "shopping",
    // ...
  };
  return category_map[primary] || "other";
}
```

#### Integration Flow (ALL LAYERS REQUIRED)

Even for external data ingestion, ALL layers must be called:

```
Orchestrator (coordinates everything)
     │
     │  ┌─────────────────────────────────────────────────────────┐
     │  │ 1. INTEGRATION LAYER (fetch external data)              │
     │  └─────────────────────────────────────────────────────────┘
     ├──→ plaid_client.get_accounts()           # Fetch from Plaid API
     │           │
     │           ▼
     │    [Raw AccountBase[]]                   # RAW SDK types only!
     │           │
     │           ▼
     ├──→ plaid_transformer.to_domain()         # Convert (PURE)
     │           │
     │           ▼
     │    [DomainResult<Account[]>]
     │
     │  ┌─────────────────────────────────────────────────────────┐
     │  │ 2. RESOLVER LAYER (analyze dependencies) - REQUIRED     │
     │  └─────────────────────────────────────────────────────────┘
     ├──→ resolver.analyze_dependencies()       # Even if trivial!
     │           │
     │           ▼
     │    [DependencyResult]                    # May be empty, but called
     │
     │  ┌─────────────────────────────────────────────────────────┐
     │  │ 3. DOMAIN LAYER (business rules) - REQUIRED             │
     │  └─────────────────────────────────────────────────────────┘
     ├──→ domain_service.validate()             # Even if trivial!
     │           │
     │           ▼
     │    [DomainResult<Account[]>]             # May pass through unchanged
     │
     │  ┌─────────────────────────────────────────────────────────┐
     │  │ 4. REPOSITORY LAYER (persist)                           │
     │  └─────────────────────────────────────────────────────────┘
     └──→ account_repo.save_batch()             # Persist to Firestore
```

**Why call Resolver and Domain even when "trivial"?**
- Resolver returns `no_dependencies()` → but it's still called and traced
- Domain returns input unchanged → but it's still called and traced
- This ensures consistent patterns, complete traces, and easy extensibility

#### Webhook Handling

External webhooks (Plaid, Stripe, etc.) are handled as HTTP entry points:

```typescript
// /src/functions/entry/http/plaid_webhook.entry.ts

export const plaid_webhook = onRequest(async (req, res) => {
  // 1. Validate webhook signature
  if (!verify_plaid_signature(req)) {
    res.status(401).send("Invalid signature");
    return;
  }

  // 2. Parse payload
  const payload = req.body as PlaidWebhookPayload;

  // 3. Create trace context
  const trace: TraceContext = {
    trace_id: uuid(),
    span_id: uuid(),
  };

  // 4. Route to appropriate orchestrator or enqueue job
  switch (payload.webhook_type) {
    case "TRANSACTIONS":
      await job_queue.enqueue({
        type: "sync_plaid_transactions",
        payload: { item_id: payload.item_id },
        trace_id: trace.trace_id,
      });
      break;
    // ... other webhook types
  }

  res.status(200).send("OK");
});
```

---

## 3. Type System

### 3.1 Trace Context

```typescript
interface TraceContext {
  trace_id: string;      // Global ID for entire workflow
  span_id: string;       // ID for current function execution
  causation_id?: string; // Parent span that triggered this
  debug_mode?: boolean;  // Enables full Tier 2 logging
}
```

### 3.2 Orchestrator Context

```typescript
interface OrchestratorContext<TInput> extends TraceContext {
  input: TInput;
  user_id: string;
  idempotency_key: string;
}
```

### 3.3 Domain Result

```typescript
interface DomainResult<T> {
  entity?: T;
  entities?: T[];
  validation_errors?: string[];
}
```

### 3.4 Write Result

```typescript
interface WriteResult {
  entity_type: string;
  entity_id: string;
  operation: "replace" | "append" | "merge";
  before_hash: string;
  after_hash: string;
}
```

### 3.5 Dependency Result

```typescript
interface DependencyResult {
  affected_entities: string[];
  recomputation_scope: "none" | "single" | "batch" | "full";
  consistency_risk: "low" | "medium" | "high";
  required_rebuild: boolean;
}
```

### 3.6 Domain Event

```typescript
interface DomainEvent<T> {
  event_id: string;
  type: string;
  payload: T;
  trace_id: string;
  causation_id: string;
  created_at: Timestamp;
}
```

### 3.7 Standard Response

```typescript
interface FunctionResponse<T> {
  success: boolean;
  data?: T;
  trace_id: string;                  // ALWAYS included
  processing_background?: boolean;   // True when async work deferred
  error?: {
    code: string;
    message: string;
  };
}
```

### 3.8 Error Types

```typescript
// /src/functions/types/errors.ts

/**
 * Base error class for all domain errors
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/**
 * Thrown when business validation fails in domain services
 */
export class ValidationError extends DomainError {
  constructor(
    public readonly errors: string[],
    details?: Record<string, unknown>
  ) {
    super(errors.join("; "), "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

/**
 * Thrown when a request with the same idempotency key is already processing
 */
export class IdempotencyConflictError extends DomainError {
  constructor(idempotency_key: string) {
    super(
      `Request with idempotency key ${idempotency_key} is already processing`,
      "IDEMPOTENCY_CONFLICT",
      { idempotency_key }
    );
    this.name = "IdempotencyConflictError";
  }
}

/**
 * Thrown when performance budget is exceeded
 */
export class PerformanceBudgetExceededError extends DomainError {
  constructor(
    public readonly budget: { max_reads: number; max_writes: number; max_time_ms: number },
    public readonly actual: { reads: number; writes: number; time_ms: number }
  ) {
    super(
      `Performance budget exceeded: reads=${actual.reads}/${budget.max_reads}, writes=${actual.writes}/${budget.max_writes}, time=${actual.time_ms}/${budget.max_time_ms}`,
      "PERFORMANCE_BUDGET_EXCEEDED",
      { budget, actual }
    );
    this.name = "PerformanceBudgetExceededError";
  }
}

/**
 * Thrown when an entity is not found
 */
export class NotFoundError extends DomainError {
  constructor(entity_type: string, entity_id: string) {
    super(
      `${entity_type} with id ${entity_id} not found`,
      "NOT_FOUND",
      { entity_type, entity_id }
    );
    this.name = "NotFoundError";
  }
}

/**
 * Thrown when user lacks permission for an operation
 */
export class PermissionDeniedError extends DomainError {
  constructor(operation: string, resource?: string) {
    super(
      `Permission denied for ${operation}${resource ? ` on ${resource}` : ""}`,
      "PERMISSION_DENIED",
      { operation, resource }
    );
    this.name = "PermissionDeniedError";
  }
}
```

### 3.9 Input Validation (Zod Schemas)

We use **Zod** for runtime input validation at the Entry layer.

```typescript
// /src/functions/types/schemas/transaction.schema.ts

import { z } from "zod";

/**
 * Schema for creating a transaction
 * Used in Entry layer to validate incoming requests
 */
export const create_transaction_schema = z.object({
  idempotency_key: z.string().uuid("idempotency_key must be a valid UUID"),
  amount: z.number().positive("amount must be positive"),
  date: z.string().datetime("date must be ISO 8601 format"),
  category: z.string().min(1, "category is required"),
  account_id: z.string().min(1, "account_id is required"),
  description: z.string().optional(),
  splits: z.array(z.object({
    category: z.string().min(1),
    amount: z.number().positive(),
  })).optional(),
  debug_mode: z.boolean().optional(),
});

export type CreateTransactionInput = z.infer<typeof create_transaction_schema>;

/**
 * Schema for updating a transaction
 */
export const update_transaction_schema = z.object({
  idempotency_key: z.string().uuid(),
  transaction_id: z.string().min(1),
  amount: z.number().positive().optional(),
  date: z.string().datetime().optional(),
  category: z.string().min(1).optional(),
  description: z.string().optional(),
});

export type UpdateTransactionInput = z.infer<typeof update_transaction_schema>;
```

**Using schemas in Entry layer:**

```typescript
// In entry function
import { create_transaction_schema } from "../types/schemas/transaction.schema";

export const create_transaction = on_call(async (request) => {
  // 1. Auth check...

  // 2. Validate with Zod
  const validation = create_transaction_schema.safeParse(request.data);
  if (!validation.success) {
    throw new HttpsError(
      "invalid-argument",
      validation.error.errors.map(e => e.message).join("; "),
      { trace_id: "not-yet-created", validation_errors: validation.error.errors }
    );
  }

  // 3. Now use validated data
  const input = validation.data;
  // ...
});
```

---

## 3.10 Function Patterns

### Callable Functions (onCall)

The primary pattern - used for user-initiated operations.

```
Client → Entry (onCall) → Orchestrator → ... → Response
```

### Firestore Triggers (onDocumentCreated, etc.)

For reacting to database changes. Triggers follow a simplified flow:

```
Firestore Change → Trigger Entry → Orchestrator → ...
```

**Key differences from onCall:**
- No auth check (system-initiated)
- No idempotency_key from client (use document ID)
- Must handle replay (triggers can fire multiple times)

```typescript
// /src/functions/entry/triggers/on_transaction_written.trigger.ts

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { recompute_budget_orchestrator } from "../../orchestrators/recompute_budget.orchestrator";

export const on_transaction_written = onDocumentWritten(
  "transactions/{transaction_id}",
  async (event) => {
    // 1. Extract data
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const transaction_id = event.params.transaction_id;

    // 2. Determine change type
    const change_type = !before ? "created" : !after ? "deleted" : "updated";

    // 3. Create trace context (no user auth)
    const trace: TraceContext = {
      trace_id: uuid(),
      span_id: uuid(),
      debug_mode: false,
    };

    // 4. Use document ID as idempotency key
    const idempotency_key = `trigger:${transaction_id}:${event.id}`;

    // 5. Call orchestrator
    await recompute_budget_orchestrator({
      ...trace,
      input: { transaction_id, change_type, before, after },
      user_id: after?.user_id || before?.user_id,
      idempotency_key,
    });
  }
);
```

### Scheduled Functions (onSchedule)

For cron jobs. Similar to triggers - no auth, system-initiated.

```typescript
// /src/functions/entry/scheduled/daily_consistency_check.scheduled.ts

import { onSchedule } from "firebase-functions/v2/scheduler";
import { run_consistency_check_orchestrator } from "../../orchestrators/run_consistency_check.orchestrator";

export const daily_consistency_check = onSchedule(
  "0 3 * * *", // 3 AM daily
  async (event) => {
    const trace: TraceContext = {
      trace_id: uuid(),
      span_id: uuid(),
      debug_mode: false,
    };

    // Use schedule time as idempotency key
    const idempotency_key = `scheduled:consistency:${event.scheduleTime}`;

    await run_consistency_check_orchestrator({
      ...trace,
      input: { check_type: "full" },
      user_id: "system",
      idempotency_key,
    });
  }
);
```

### Query/Read-Only Functions

For read operations that don't modify state. **Simplified flow - skip Resolver and Events.**

```
Entry → Orchestrator → Repository (read) → Response
```

```typescript
// /src/functions/orchestrators/get_transactions.orchestrator.ts

export async function get_transactions_orchestrator(
  ctx: OrchestratorContext<GetTransactionsInput>
): Promise<Transaction[]> {
  const span = create_span(ctx);

  // 1. Log start
  log_minimal({ ...span, layer: "orchestrator", function: "get_transactions", status: "start" });

  // 2. NO idempotency check for reads (they're inherently idempotent)

  // 3. NO dependency resolution (not modifying anything)

  // 4. Repository read
  const transactions = await transaction_repo.get_by_user_id_and_period(
    ctx.user_id,
    ctx.input.period_id
  );

  // 5. NO events (nothing changed)

  // 6. Async logging
  fire_and_forget(() => log_async_debug({ ...span, result_count: transactions.length }));

  return transactions;
}
```

### Delete Operations

Two patterns: **soft delete** (preferred) and **hard delete**.

**Soft Delete (Recommended):**
```typescript
// Domain service
export function compute_delete_transaction(
  existing: Transaction
): DomainResult<Transaction> {
  return {
    entity: {
      ...existing,
      is_active: false,
      deleted_at: now(),
    }
  };
}
```

**Hard Delete (Use sparingly):**
```typescript
// Repository
export const transaction_repo = {
  async hard_delete(entity_id: string): Promise<WriteResult> {
    const before = await this.get_by_id(entity_id);
    await doc_ref(entity_id).delete();

    return {
      entity_type: "transaction",
      entity_id,
      operation: "delete",
      before_hash: hash(before),
      after_hash: "deleted",
    };
  }
};
```

**When to use which:**
| Scenario | Pattern |
|----------|---------|
| User data | Soft delete (GDPR recovery) |
| Audit trail needed | Soft delete |
| Derived/computed data | Hard delete OK |
| Storage cost concern | Hard delete with archive |

---

## 3.11 Cloud Tasks Setup

Cloud Tasks is used for async job processing.

### Setup

1. **Enable Cloud Tasks API** in Google Cloud Console

2. **Create a queue:**
```bash
gcloud tasks queues create family-finance-jobs \
  --location=us-central1 \
  --max-attempts=5 \
  --min-backoff=10s \
  --max-backoff=300s
```

3. **Create the job handler function:**
```typescript
// /src/functions/entry/jobs/process_job.entry.ts

import { onRequest } from "firebase-functions/v2/https";

export const process_job = onRequest(async (req, res) => {
  // Verify request is from Cloud Tasks
  const task_name = req.headers["x-cloudtasks-taskname"];
  if (!task_name) {
    res.status(403).send("Forbidden");
    return;
  }

  const { job_type, payload, trace_id } = req.body;

  const trace: TraceContext = {
    trace_id,
    span_id: uuid(),
    causation_id: trace_id,
  };

  try {
    switch (job_type) {
      case "recompute_budget":
        await recompute_budget_orchestrator({ ...trace, ...payload });
        break;
      case "sync_plaid":
        await sync_plaid_orchestrator({ ...trace, ...payload });
        break;
      default:
        throw new Error(`Unknown job type: ${job_type}`);
    }
    res.status(200).send("OK");
  } catch (error) {
    console.error("Job failed:", error);
    res.status(500).send("Failed");
  }
});
```

4. **Job queue helper:**
```typescript
// /src/functions/infrastructure/job_queue.ts

import { CloudTasksClient } from "@google-cloud/tasks";

const client = new CloudTasksClient();
const PROJECT = process.env.GCLOUD_PROJECT;
const LOCATION = "us-central1";
const QUEUE = "family-finance-jobs";
const HANDLER_URL = `https://${LOCATION}-${PROJECT}.cloudfunctions.net/process_job`;

interface JobPayload {
  job_type: string;
  payload: Record<string, unknown>;
  trace_id: string;
}

export const job_queue = {
  async enqueue(job: JobPayload, delay_seconds?: number): Promise<string> {
    const parent = client.queuePath(PROJECT!, LOCATION, QUEUE);

    const task = {
      httpRequest: {
        httpMethod: "POST" as const,
        url: HANDLER_URL,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from(JSON.stringify(job)).toString("base64"),
      },
      scheduleTime: delay_seconds
        ? { seconds: Date.now() / 1000 + delay_seconds }
        : undefined,
    };

    const [response] = await client.createTask({ parent, task });
    return response.name!;
  },
};
```

### Dead Letter Queue

Failed jobs (after max retries) go to a DLQ:

```bash
gcloud tasks queues create family-finance-dlq \
  --location=us-central1
```

Configure the main queue to route failed tasks:
```bash
gcloud tasks queues update family-finance-jobs \
  --location=us-central1 \
  --dead-letter-queue=family-finance-dlq
```

### 3.12 Firestore Trigger Rules

We use **Firebase's built-in Firestore triggers** instead of a custom event system. Triggers automatically fire when documents change.

**Why Firestore Triggers?**
- Built-in, battle-tested infrastructure
- Automatic retry on failure
- At-least-once delivery guaranteed
- No custom event_bus to build/maintain
- Native to Firebase ecosystem

**Trigger Constraints:**

| Constraint | Requirement |
|------------|-------------|
| Performance | Execute quickly (<100ms ideal), offload heavy work to jobs |
| Idempotency | MUST guard with `${document_id}:${event.id}` - triggers can fire multiple times |
| No cascading | MUST NOT write to documents that trigger other triggers (prevents loops) |
| No mutations | Call orchestrators or enqueue jobs, NEVER write directly to Firestore |
| No logic | MUST NOT contain business logic |

**Trigger Template:**

```typescript
// /src/functions/entry/triggers/on_transaction_written.trigger.ts

import { onDocumentWritten } from "firebase-functions/v2/firestore";

export const on_transaction_written = onDocumentWritten(
  "transactions/{transaction_id}",
  async (event) => {
    const transaction_id = event.params.transaction_id;

    // 1. IDEMPOTENCY GUARD (required - triggers can fire multiple times)
    const idempotency_key = `trigger:${transaction_id}:${event.id}`;
    if (await already_processed(idempotency_key)) return;

    // 2. Extract change info
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const change_type = !before ? "created" : !after ? "deleted" : "updated";

    // 3. Create trace context
    const trace: TraceContext = {
      trace_id: uuid(),
      span_id: uuid(),
    };

    // 4. ALLOWED: Call orchestrator OR enqueue job (not both, never direct mutation)
    await recompute_affected_budgets_orchestrator({
      ...trace,
      input: { transaction_id, change_type },
      user_id: after?.user_id || before?.user_id,
      idempotency_key,
    });

    // 5. Mark processed
    await mark_processed(idempotency_key);
  }
);
```

**Trigger → Job Pattern (for heavy work):**
```
Firestore write → Trigger fires → enqueueJob → orchestrator → system updates
```

**Trigger Loop Prevention:**
```typescript
// ❌ BAD: Creates cascade
on_transaction_written → write to budgets → on_budget_written → write to analytics → ...

// ✅ GOOD: Enqueue job instead of direct write
on_transaction_written → enqueue "recompute_budgets" job → job handler → orchestrator → write
```

**When to use Trigger vs Orchestrator-enqueued Job:**

| Scenario | Trigger | Job from Orchestrator |
|----------|---------|----------------------|
| ALWAYS react to document change | ✅ | |
| Conditional based on orchestrator logic | | ✅ |
| Need reaction even if original orchestrator fails | ✅ | |
| Part of same logical operation | | ✅ |

---

## 4. Dependency Definitions

### 4.1 What Are Dependency Definitions?

Dependency Definitions are **declarative rules** that specify:

> WHEN a specific change occurs → WHICH derived systems become invalid

They are the "what" that feeds the Resolver (the "how").

**Key Principle:**
```
Dependencies are DECLARED, not DISCOVERED.
The system does NOT infer relationships by inspecting code.
All dependencies must be explicitly defined.
```

**Invalidation Model (Critical):**

The system MUST be **invalidation-based**, NEVER **mutation-based**.

```typescript
// ❌ FORBIDDEN: Mutation-based
transaction changed → increment budget by +42

// ✅ REQUIRED: Invalidation-based
transaction changed → budget_snapshot invalid → rebuild budget_snapshot
```

**Why?** Invalidation + rebuild ensures:
- No accumulated drift from incremental updates
- Full consistency via deterministic recomputation
- Easier debugging (can always rebuild from source)

### 4.2 Dependency Definition Types

```typescript
// /src/functions/types/dependency.types.ts

/**
 * Canonical data sources that can trigger invalidation
 */
type CanonicalSource =
  | "transaction"
  | "account"
  | "budget"
  | "recurring_outflow"
  | "recurring_inflow";

/**
 * Derived systems that can be invalidated
 */
type DerivedNodeType =
  | "budget_snapshot"
  | "account_summary"
  | "cashflow_projection"
  | "period_totals"
  | "analytics"
  | "goal_progress"
  | "bill_matching";

/**
 * How to find affected entities within a derived system
 */
type ResolveStrategy =
  | "by_category"      // Match by category field
  | "by_account"       // Match by account_id field
  | "by_date_range"    // Match by overlapping date ranges
  | "by_period"        // Match by period_id
  | "by_user"          // All entities for the user
  | "full_rebuild";    // Rebuild entire derived system

/**
 * A single dependency definition
 */
interface DependencyDefinition {
  /** The canonical source that triggers this dependency */
  source: CanonicalSource;

  /** What triggers invalidation */
  triggers: {
    /** The event type (e.g., "transaction.created") */
    event: string;
    /** Optional: only trigger if these fields changed */
    fields?: string[];
  };

  /** What gets invalidated */
  targets: Array<{
    /** The derived system to invalidate */
    node: DerivedNodeType;
    /** Scope of invalidation */
    scope: "entity" | "collection" | "global";
    /** How to find affected entities */
    resolve_strategy: ResolveStrategy;
    /** Whether to continue traversing to dependents of this node */
    propagation: "stop" | "continue";
  }>;
}
```

### 4.3 Change Model Types

```typescript
// /src/functions/types/changes.types.ts

/**
 * Represents a change to canonical data.
 * This is what flows into the dependency system.
 */
type TransactionChange =
  | {
      type: "transaction.created";
      transaction_id: string;
      user_id: string;
      full_entity: Transaction;
    }
  | {
      type: "transaction.updated";
      transaction_id: string;
      user_id: string;
      before: Partial<Transaction>;
      after: Partial<Transaction>;
      changed_fields: Array<"amount" | "date" | "category" | "account_id" | "splits">;
    }
  | {
      type: "transaction.deleted";
      transaction_id: string;
      user_id: string;
    };

type AccountChange =
  | {
      type: "account.created";
      account_id: string;
      user_id: string;
      full_entity: Account;
    }
  | {
      type: "account.updated";
      account_id: string;
      user_id: string;
      changed_fields: Array<"currentBalance" | "name" | "isActive">;
    }
  | {
      type: "account.deleted";
      account_id: string;
      user_id: string;
    };

type BudgetChange =
  | {
      type: "budget.created";
      budget_id: string;
      user_id: string;
      full_entity: Budget;
    }
  | {
      type: "budget.updated";
      budget_id: string;
      user_id: string;
      changed_fields: Array<"amount" | "category" | "period">;
    };

/** Union of all change types */
type CanonicalChange = TransactionChange | AccountChange | BudgetChange;
```

### 4.4 Defining Dependencies

Location: `/src/functions/dependencies/definitions.ts`

```typescript
// /src/functions/dependencies/definitions.ts

import { DependencyDefinition } from "../types/dependency.types";

/**
 * TRANSACTION DEPENDENCIES
 *
 * When transactions change, these derived systems are affected.
 */
export const transactionDependencies: DependencyDefinition[] = [
  // Transaction created/updated → Budget snapshots need recalculation
  {
    source: "transaction",
    triggers: {
      event: "transaction.created",
    },
    targets: [
      {
        node: "budget_snapshot",
        scope: "entity",
        resolve_strategy: "by_category",
        propagation: "continue", // Budget changes may affect analytics
      },
      {
        node: "account_summary",
        scope: "entity",
        resolve_strategy: "by_account",
        propagation: "stop",
      },
    ],
  },

  // Transaction amount/category change → Recalculate affected budgets
  {
    source: "transaction",
    triggers: {
      event: "transaction.updated",
      fields: ["amount", "category", "date", "splits"],
    },
    targets: [
      {
        node: "budget_snapshot",
        scope: "entity",
        resolve_strategy: "by_category",
        propagation: "continue",
      },
      {
        node: "period_totals",
        scope: "entity",
        resolve_strategy: "by_period",
        propagation: "stop",
      },
    ],
  },

  // Transaction deleted → Same as update
  {
    source: "transaction",
    triggers: {
      event: "transaction.deleted",
    },
    targets: [
      {
        node: "budget_snapshot",
        scope: "entity",
        resolve_strategy: "by_category",
        propagation: "continue",
      },
    ],
  },
];

/**
 * ACCOUNT DEPENDENCIES
 */
export const accountDependencies: DependencyDefinition[] = [
  {
    source: "account",
    triggers: {
      event: "account.updated",
      fields: ["currentBalance"],
    },
    targets: [
      {
        node: "account_summary",
        scope: "entity",
        resolve_strategy: "by_account",
        propagation: "stop",
      },
      {
        node: "cashflow_projection",
        scope: "collection",
        resolve_strategy: "by_user",
        propagation: "stop",
      },
    ],
  },
];

/**
 * BUDGET DEPENDENCIES
 */
export const budgetDependencies: DependencyDefinition[] = [
  {
    source: "budget",
    triggers: {
      event: "budget.updated",
      fields: ["amount"],
    },
    targets: [
      {
        node: "budget_snapshot",
        scope: "entity",
        resolve_strategy: "by_category",
        propagation: "continue",
      },
    ],
  },
];

/**
 * ALL DEPENDENCIES - Combined for the graph engine
 */
export const allDependencyDefinitions: DependencyDefinition[] = [
  ...transactionDependencies,
  ...accountDependencies,
  ...budgetDependencies,
];
```

### 4.5 The Dependency Graph Engine

The graph engine is a **pure function** that determines which nodes are invalidated.

Location: `/src/functions/dependencies/graphEngine.ts`

```typescript
// /src/functions/dependencies/graphEngine.ts

import { DependencyDefinition, DerivedNodeType, ResolveStrategy } from "../types/dependency.types";
import { CanonicalChange } from "../types/changes.types";

interface InvalidatedNode {
  node: DerivedNodeType;
  resolve_strategy: ResolveStrategy;
  scope: "entity" | "collection" | "global";
  propagation: "stop" | "continue";
}

interface GraphEngineResult {
  invalidated_nodes: InvalidatedNode[];
}

/**
 * Pure function: Given a change and definitions, return invalidated nodes.
 *
 * This function does NOT:
 * - Perform IO
 * - Query Firestore
 * - Compute entity IDs (that's the Resolver's job)
 */
export function computeInvalidatedNodes(
  change: CanonicalChange,
  definitions: DependencyDefinition[]
): GraphEngineResult {
  const invalidated: InvalidatedNode[] = [];

  // Find matching definitions
  for (const def of definitions) {
    // Check if source matches
    if (!change.type.startsWith(def.source)) continue;

    // Check if event matches
    if (def.triggers.event !== change.type) continue;

    // Check if fields match (if specified)
    if (def.triggers.fields && "changed_fields" in change) {
      const hasMatchingField = def.triggers.fields.some(
        field => change.changed_fields.includes(field)
      );
      if (!hasMatchingField) continue;
    }

    // Add all targets
    for (const target of def.targets) {
      invalidated.push({
        node: target.node,
        resolve_strategy: target.resolve_strategy,
        scope: target.scope,
        propagation: target.propagation,
      });
    }
  }

  // Handle transitive dependencies (propagation: "continue")
  const toProcess = [...invalidated.filter(n => n.propagation === "continue")];
  const processed = new Set<string>();

  while (toProcess.length > 0) {
    const current = toProcess.pop()!;
    const key = `${current.node}:${current.resolve_strategy}`;
    if (processed.has(key)) continue;
    processed.add(key);

    // Find definitions where this node is the source
    // (For derived-to-derived dependencies)
    // This would require additional definitions for derived → derived
  }

  return { invalidated_nodes: invalidated };
}
```

### 4.6 Scope Resolvers

Scope Resolvers map invalidated nodes to **specific entity IDs**.

Location: `/src/functions/dependencies/scopeResolvers.ts`

```typescript
// /src/functions/dependencies/scopeResolvers.ts

import { DerivedNodeType, ResolveStrategy } from "../types/dependency.types";
import { CanonicalChange } from "../types/changes.types";
import { budgetRepo } from "../repositories/budget.repo";
import { accountRepo } from "../repositories/account.repo";

interface ScopeResolverContext {
  node: DerivedNodeType;
  resolve_strategy: ResolveStrategy;
  change: CanonicalChange;
  user_id: string;
}

/**
 * Given an invalidated node and strategy, return affected entity IDs.
 *
 * This function MAY:
 * - Read from repositories
 * - Filter and map data
 *
 * This function MUST NOT:
 * - Perform business logic
 * - Mutate any state
 * - Emit events
 */
export async function resolveAffectedEntities(
  ctx: ScopeResolverContext
): Promise<string[]> {
  switch (ctx.resolve_strategy) {
    case "by_category":
      return resolveByCategoryStrategy(ctx);
    case "by_account":
      return resolveByAccountStrategy(ctx);
    case "by_period":
      return resolveByPeriodStrategy(ctx);
    case "by_user":
      return resolveByUserStrategy(ctx);
    case "by_date_range":
      return resolveByDateRangeStrategy(ctx);
    case "full_rebuild":
      return ["__FULL_REBUILD__"]; // Special marker
    default:
      throw new Error(`Unknown resolve strategy: ${ctx.resolve_strategy}`);
  }
}

async function resolveByCategoryStrategy(ctx: ScopeResolverContext): Promise<string[]> {
  // Get category from the change
  const category = extractCategoryFromChange(ctx.change);
  if (!category) return [];

  // Find all budgets with this category
  const budgets = await budgetRepo.getByUserId(ctx.user_id);
  return budgets
    .filter(b => b.category === category)
    .map(b => b.id);
}

async function resolveByAccountStrategy(ctx: ScopeResolverContext): Promise<string[]> {
  const accountId = extractAccountIdFromChange(ctx.change);
  if (!accountId) return [];
  return [accountId]; // The account itself
}

async function resolveByPeriodStrategy(ctx: ScopeResolverContext): Promise<string[]> {
  const periodId = extractPeriodIdFromChange(ctx.change);
  if (!periodId) return [];

  // Find all entities in this period
  // Implementation depends on your period structure
  return [periodId];
}

async function resolveByUserStrategy(ctx: ScopeResolverContext): Promise<string[]> {
  // Return all entities of this type for the user
  switch (ctx.node) {
    case "budget_snapshot":
      const budgets = await budgetRepo.getByUserId(ctx.user_id);
      return budgets.map(b => b.id);
    case "account_summary":
      const accounts = await accountRepo.getByUserId(ctx.user_id);
      return accounts.map(a => a.id);
    default:
      return [];
  }
}

async function resolveByDateRangeStrategy(ctx: ScopeResolverContext): Promise<string[]> {
  const date = extractDateFromChange(ctx.change);
  if (!date) return [];

  // Find all entities whose date range includes this date
  // Implementation depends on your date range structure
  return [];
}

// Helper functions to extract data from changes
function extractCategoryFromChange(change: CanonicalChange): string | null {
  if ("full_entity" in change && change.full_entity.category) {
    return change.full_entity.category;
  }
  if ("after" in change && change.after.category) {
    return change.after.category;
  }
  return null;
}

function extractAccountIdFromChange(change: CanonicalChange): string | null {
  if ("account_id" in change) return change.account_id;
  if ("full_entity" in change && change.full_entity.account_id) {
    return change.full_entity.account_id;
  }
  return null;
}

function extractPeriodIdFromChange(change: CanonicalChange): string | null {
  if ("full_entity" in change && change.full_entity.periodId) {
    return change.full_entity.periodId;
  }
  return null;
}

function extractDateFromChange(change: CanonicalChange): Date | null {
  if ("full_entity" in change && change.full_entity.date) {
    return change.full_entity.date;
  }
  return null;
}
```

### 4.7 Putting It Together in the Orchestrator

```typescript
// In your orchestrator, the flow is:

// 1. Create the change object
const change: TransactionChange = {
  type: "transaction.created",
  transaction_id: domain.entity.id,
  user_id: ctx.user_id,
  full_entity: domain.entity,
};

// 2. Run the graph engine (PURE - no IO)
const { invalidated_nodes } = computeInvalidatedNodes(change, allDependencyDefinitions);

// 3. Resolve to entity IDs (reads only)
const affected_entities: string[] = [];
for (const node of invalidated_nodes) {
  const entities = await resolveAffectedEntities({
    node: node.node,
    resolve_strategy: node.resolve_strategy,
    change,
    user_id: ctx.user_id,
  });
  affected_entities.push(...entities);
}

// 4. Deduplicate
const unique_affected = [...new Set(affected_entities)];

// 5. Use in job scheduling
if (unique_affected.length > 0) {
  await jobQueue.enqueue({
    type: "recomputeDerivedState",
    payload: { affected_entities: unique_affected },
    trace_id: ctx.trace_id,
  });
}
```

### 4.8 Adding a New Dependency

When you need to add a new dependency:

1. **Identify the source** (what canonical data is changing?)
2. **Identify the target** (what derived data needs updating?)
3. **Choose the resolve strategy** (how do we find affected entities?)
4. **Add the definition** to `/src/functions/dependencies/definitions.ts`
5. **Implement the resolver** if using a new strategy

**Example: Adding a new dependency**

```typescript
// New requirement: When a recurring outflow changes, update cashflow projections

// 1. Add to definitions.ts
export const recurringOutflowDependencies: DependencyDefinition[] = [
  {
    source: "recurring_outflow",
    triggers: {
      event: "recurring_outflow.updated",
      fields: ["amount", "frequency", "nextDueDate"],
    },
    targets: [
      {
        node: "cashflow_projection",
        scope: "collection",
        resolve_strategy: "by_user", // All projections for this user
        propagation: "stop",
      },
    ],
  },
];

// 2. Add to allDependencyDefinitions
export const allDependencyDefinitions: DependencyDefinition[] = [
  ...transactionDependencies,
  ...accountDependencies,
  ...budgetDependencies,
  ...recurringOutflowDependencies, // NEW
];
```

### 4.9 Dependency Definition Rules

| Rule | Description |
|------|-------------|
| **Explicit only** | Never infer dependencies from code |
| **No cycles** | DAG only - validate at startup |
| **Source is canonical** | Only canonical entities can be sources |
| **Target is derived** | Targets are always derived/computed state |
| **One direction** | Canonical → Derived, never reverse |
| **Fields are optional** | If omitted, any change triggers |

### 4.10 Validating the Dependency Graph

```typescript
// /src/functions/dependencies/validator.ts

import { allDependencyDefinitions } from "./definitions";

/**
 * Call this at startup to validate the dependency graph.
 * Throws if cycles are detected.
 */
export function validateDependencyGraph(): void {
  const graph = new Map<string, string[]>();

  // Build adjacency list
  for (const def of allDependencyDefinitions) {
    for (const target of def.targets) {
      if (target.propagation === "continue") {
        const edges = graph.get(def.source) || [];
        edges.push(target.node);
        graph.set(def.source, edges);
      }
    }
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function hasCycle(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);

    for (const neighbor of graph.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (hasCycle(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      if (hasCycle(node)) {
        throw new Error(`Cycle detected in dependency graph involving: ${node}`);
      }
    }
  }

  console.log("✓ Dependency graph validated - no cycles detected");
}
```

---

## 5. Implementation Process

### 5.1 Before You Start

1. **Identify the domain** (accounts, transactions, budgets, etc.)
2. **Identify the operation** (create, update, delete, query)
3. **Read existing code** in that domain
4. **Check for similar functions** to maintain consistency

### 5.2 Step-by-Step Implementation

#### Step 1: Define Types

Create or update types in `/src/functions/types/`:

```typescript
// /src/functions/types/{domain}.types.ts

export interface Create{Entity}Input {
  // Input from client (validated but not yet processed)
}

export interface {Entity} {
  // Domain entity (what gets stored)
}
```

#### Step 2: Implement Domain Service

Create `/src/functions/domain/{entity}.service.ts`:

```typescript
export function compute_{entity}(input: Create{Entity}Input): DomainResult<{Entity}> {
  // 1. Validation
  if (!input.required_field) {
    return { validation_errors: ["Missing required field"] };
  }

  // 2. Computation
  const computed = /* pure calculation */;

  // 3. Return entity
  return {
    entity: {
      id: input.id,
      ...computed,
      created_at: now()
    }
  };
}
```

**Test immediately** - domain services should be unit testable with no mocks.

#### Step 3: Implement Repository

Create `/src/functions/repositories/{entity}.repo.ts`:

```typescript
export const {entity}_repo = {
  async save(data: DomainResult<{Entity}>): Promise<WriteResult[]> {
    if (!data.entity) throw new Error("Repository requires entity");

    const entity = data.entity;
    const before = await this.get_by_id(entity.id);

    const batch = firestore.batch();
    batch.set(doc_ref(entity.id), entity);
    await batch.commit();

    return [{
      entity_type: "{entity}",
      entity_id: entity.id,
      operation: "replace",
      before_hash: hash(before),
      after_hash: hash(entity)
    }];
  },

  async get_by_id(id: string): Promise<{Entity} | null> {
    const doc = await doc_ref(id).get();
    return doc.exists ? map_to_domain(doc.data()) : null;
  },

  async get_by_user_id(user_id: string): Promise<{Entity}[]> {
    const snapshot = await firestore
      .collection("{entities}")
      .where("user_id", "==", user_id)
      .get();
    return snapshot.docs.map(doc => map_to_domain(doc.data()));
  }
};
```

#### Step 4: Implement Resolver

Create `/src/functions/resolvers/{entity}.resolver.ts`:

```typescript
export async function resolve_{entity}_dependencies(
  ctx: OrchestratorContext<Create{Entity}Input>
): Promise<DependencyResult> {
  // 1. Fetch relevant data (READ ONLY)
  const related_entities = await {related}_repo.get_by_user_id(ctx.user_id);

  // 2. Filter by relationships (LOOKUP ONLY, NO LOGIC)
  const affected = related_entities
    .filter(e => e.category === ctx.input.category)
    .map(e => e.id);

  // 3. Classify scope
  const scope = affected.length === 0 ? "none"
              : affected.length === 1 ? "single"
              : "batch";

  return {
    affected_entities: affected,
    recomputation_scope: scope,
    consistency_risk: "medium",
    required_rebuild: false
  };
}
```

#### Step 5: Implement Orchestrator

Create `/src/functions/orchestrators/{operation}_{entity}.orchestrator.ts`:

```typescript
const BUDGET = { max_reads: 25, max_writes: 10, max_time_ms: 500 };

export async function create_{entity}_orchestrator(
  ctx: OrchestratorContext<Create{Entity}Input>
): Promise<{Entity}> {
  const span = create_span(ctx);
  const perf = { reads: 0, writes: 0, start: Date.now() };

  // 1. Log start
  log_minimal({ ...span, layer: "orchestrator", function: "create_{entity}", status: "start" });

  // 2. Idempotency check
  const existing = await idempotency_store.get(ctx.idempotency_key);
  if (existing) {
    log_minimal({ ...span, status: "idempotent_return" });
    return existing.response;
  }
  perf.reads++;

  // 3. Dependency resolution
  const dependencies = await resolve_{entity}_dependencies({
    ...ctx,
    span_id: create_child_span(span)
  });
  perf.reads += dependencies.reads_performed || 1;

  // 4. Domain computation (PURE - no IO)
  const domain = compute_{entity}(ctx.input);
  if (domain.validation_errors) {
    throw new ValidationError(domain.validation_errors);
  }

  // 5. Persistence
  const writes = await {entity}_repo.save(domain);
  perf.writes += writes.length;
  check_budget(perf, BUDGET); // Throws if exceeded

  // 6. Event emission
  await event_bus.emit({
    event_id: uuid(),
    type: "{entity}.created",
    payload: { {entity}_id: domain.entity.id },
    trace_id: ctx.trace_id,
    causation_id: span.span_id,
    created_at: now()
  });

  // 7. Job scheduling (if needed)
  if (dependencies.recomputation_scope !== "none") {
    await job_queue.enqueue({
      type: "recompute_{related}",
      payload: { affected: dependencies.affected_entities },
      trace_id: ctx.trace_id
    });
  }

  // 8. Store idempotency
  await idempotency_store.set(ctx.idempotency_key, {
    response: domain.entity,
    expires_at: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
  });

  // 9. Async debug logging
  fire_and_forget(() => log_async_debug({
    ...span,
    inputs: ctx.input,
    decisions: dependencies,
    writes,
    output: domain.entity
  }));

  return domain.entity;
}
```

#### Step 6: Implement Entry

Create `/src/functions/entry/{operation}_{entity}.entry.ts`:

```typescript
export const create_{entity} = on_call(async (request) => {
  // 1. Authentication
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }
  const user_id = request.auth.uid;

  // 2. Input validation
  const { data } = request;
  if (!data) {
    throw new HttpsError("invalid-argument", "Missing request data");
  }
  if (typeof data.amount !== "number") {
    throw new HttpsError("invalid-argument", "Invalid amount");
  }
  if (!data.idempotency_key) {
    throw new HttpsError("invalid-argument", "Missing idempotency_key");
  }

  // 3. Trace context (ROOT)
  const trace: TraceContext = {
    trace_id: uuid(),
    span_id: uuid(),
    debug_mode: data.debug_mode === true
  };

  // 4. Normalize input
  const input: Create{Entity}Input = {
    amount: data.amount,
    category: data.category,
    date: normalize_to_utc(data.date),
    // ... other fields
  };

  // 5. Call orchestrator (EXACTLY ONE)
  try {
    const result = await create_{entity}_orchestrator({
      ...trace,
      input,
      user_id,
      idempotency_key: data.idempotency_key
    });

    // 6. Response mapping
    return {
      success: true,
      data: {
        id: result.id,
        // ... map to client format
      },
      trace_id: trace.trace_id
    };
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      throw new HttpsError("aborted", "Request already processing", { trace_id: trace.trace_id });
    }
    if (error instanceof ValidationError) {
      throw new HttpsError("invalid-argument", error.message, { trace_id: trace.trace_id });
    }
    console.error("Function failed:", error);
    throw new HttpsError("internal", "Operation failed", { trace_id: trace.trace_id });
  }
});
```

---

## 6. Layer Templates

### 6.1 Entry Template

```typescript
// /src/functions/entry/{operation}_{entity}.entry.ts

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { {operation}_{entity}_orchestrator } from "../orchestrators/{operation}_{entity}.orchestrator";
import { TraceContext } from "../types/context";
import { uuid } from "../infrastructure/uuid";

export const {operation}_{entity} = onCall(async (request) => {
  // 1. AUTHENTICATION
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "User must be authenticated");
  }
  const user_id = request.auth.uid;

  // 2. INPUT VALIDATION
  const { data } = request;
  // Validate all required fields...
  // Validate types...
  // Validate idempotency_key present...

  // 3. TRACE CONTEXT (ROOT)
  const trace: TraceContext = {
    trace_id: uuid(),
    span_id: uuid(),
    debug_mode: data.debug_mode === true
  };

  // 4. NORMALIZE INPUT
  const input = {
    // Convert to internal types
    // Normalize dates to UTC
    // Remove extraneous fields
  };

  // 5. SINGLE ORCHESTRATOR CALL
  try {
    const result = await {operation}_{entity}_orchestrator({
      ...trace,
      input,
      user_id,
      idempotency_key: data.idempotency_key
    });

    // 6. RESPONSE MAPPING
    return {
      success: true,
      data: result,
      trace_id: trace.trace_id
    };
  } catch (error) {
    // Handle known error types
    // Always include trace_id in error response
    throw new HttpsError("internal", "Operation failed", { trace_id: trace.trace_id });
  }
});
```

### 6.2 Orchestrator Template

```typescript
// /src/functions/orchestrators/{operation}_{entity}.orchestrator.ts

import { OrchestratorContext } from "../types/context";
import { DomainResult } from "../types/domain";
import { resolve_{entity}_dependencies } from "../resolvers/{entity}.resolver";
import { compute_{entity} } from "../domain/{entity}.service";
import { {entity}_repo } from "../repositories/{entity}.repo";
import { event_bus } from "../events/event_bus";
import { job_queue } from "../jobs/job_queue";
import { idempotency_store } from "../infrastructure/idempotency.store";
import { create_span, create_child_span } from "../observability/tracer";
import { log_minimal, log_async_debug, fire_and_forget } from "../observability/logger";

const BUDGET = { max_reads: 25, max_writes: 10, max_time_ms: 500 };

export async function {operation}_{entity}_orchestrator(
  ctx: OrchestratorContext<{Input}Type>
): Promise<{Output}Type> {
  const span = create_span(ctx);
  const perf = { reads: 0, writes: 0, start: Date.now() };

  // 1. LOG START
  log_minimal({ ...span, layer: "orchestrator", function: "{operation}_{entity}", status: "start" });

  // 2. IDEMPOTENCY CHECK
  const existing = await idempotency_store.get(ctx.idempotency_key);
  if (existing) {
    log_minimal({ ...span, status: "idempotent_return" });
    return existing.response;
  }
  perf.reads++;

  // 3. DEPENDENCY RESOLUTION
  const dependencies = await resolve_{entity}_dependencies({
    ...ctx,
    span_id: create_child_span(span)
  });

  // 4. DOMAIN COMPUTATION (pure, no await)
  const domain = compute_{entity}(ctx.input);
  if (domain.validation_errors) {
    throw new ValidationError(domain.validation_errors);
  }

  // 5. PERSISTENCE
  const writes = await {entity}_repo.save(domain);
  perf.writes += writes.length;
  check_budget(perf, BUDGET);

  // 6. EVENT EMISSION
  await event_bus.emit({
    event_id: uuid(),
    type: "{entity}.{operation}d",
    payload: { {entity}_id: domain.entity.id },
    trace_id: ctx.trace_id,
    causation_id: span.span_id,
    created_at: now()
  });

  // 7. JOB SCHEDULING
  if (dependencies.recomputation_scope !== "none") {
    await job_queue.enqueue({
      type: "recompute_{related}",
      payload: { affected: dependencies.affected_entities },
      trace_id: ctx.trace_id
    });
  }

  // 8. IDEMPOTENCY STORE
  await idempotency_store.set(ctx.idempotency_key, {
    response: domain.entity,
    expires_at: Date.now() + 24 * 60 * 60 * 1000
  });

  // 9. ASYNC DEBUG LOGGING
  fire_and_forget(() => log_async_debug({ ...span, inputs: ctx.input, writes }));

  return domain.entity;
}
```

### 6.3 Resolver Template

```typescript
// /src/functions/resolvers/{entity}.resolver.ts

import { OrchestratorContext } from "../types/context";
import { DependencyResult } from "../types/dependency";
import { {related}_repo } from "../repositories/{related}.repo";

export async function resolve_{entity}_dependencies(
  ctx: OrchestratorContext<{Input}Type>
): Promise<DependencyResult> {
  // 1. FETCH DATA (READ ONLY)
  const related_entities = await {related}_repo.get_by_user_id(ctx.user_id);

  // 2. INITIALIZE SET
  const affected_set = new Set<string>();

  // 3. LOOKUP LOGIC (filter + map ONLY)
  for (const item of ctx.input.items) {
    const matching = related_entities.filter(e => e.field === item.field);
    matching.forEach(e => affected_set.add(e.id));
  }

  // 4. CONVERT TO ARRAY
  const affected = Array.from(affected_set);

  // 5. CLASSIFY SCOPE
  const recomputation_scope =
    affected.length === 0 ? "none" :
    affected.length === 1 ? "single" : "batch";

  // 6. RETURN RESULT
  return {
    affected_entities: affected,
    recomputation_scope,
    consistency_risk: "medium",
    required_rebuild: false
  };
}
```

### 6.4 Domain Service Template

```typescript
// /src/functions/domain/{entity}.service.ts

import { DomainResult } from "../types/domain";
import { {Entity}, Create{Entity}Input } from "../types/{entity}.types";

// NO IMPORTS FROM: repositories, infrastructure, events, jobs

export function compute_{entity}(input: Create{Entity}Input): DomainResult<{Entity}> {
  // 1. VALIDATION (pure, deterministic)
  if (!input.required_field) {
    return { validation_errors: ["Missing required field"] };
  }
  if (input.amount <= 0) {
    return { validation_errors: ["Amount must be positive"] };
  }

  // 2. COMPUTATION (pure)
  const total = input.items.reduce((sum, item) => sum + item.amount, 0);
  const normalized = normalize_data(input);

  // 3. DOMAIN RULE ENFORCEMENT
  if (total !== input.expected_total) {
    return { validation_errors: ["Items must sum to total"] };
  }

  // 4. RETURN ENTITY
  return {
    entity: {
      id: input.id,
      user_id: input.user_id,
      ...normalized,
      total,
      created_at: now(), // deterministic helper
      status: "created"
    }
  };
}

// Helper functions must also be pure
function normalize_data(input: Create{Entity}Input): Partial<{Entity}> {
  return {
    // Pure transformations only
  };
}
```

### 6.5 Repository Template

```typescript
// /src/functions/repositories/{entity}.repo.ts

import { firestore } from "../infrastructure/firestore.client";
import { WriteResult } from "../types/repository";
import { DomainResult } from "../types/domain";
import { {Entity} } from "../types/{entity}.types";
import { hash } from "../infrastructure/hash";

const COLLECTION = "{entities}";
const doc_ref = (id: string) => firestore.collection(COLLECTION).doc(id);

export const {entity}_repo = {
  // WRITE: Single entity
  async save(data: DomainResult<{Entity}>): Promise<WriteResult[]> {
    if (!data.entity) {
      throw new Error("Repository requires entity");
    }

    const entity = data.entity;
    const before = await this.get_by_id(entity.id);

    const batch = firestore.batch();
    batch.set(doc_ref(entity.id), entity);
    await batch.commit();

    return [{
      entity_type: "{entity}",
      entity_id: entity.id,
      operation: "replace",
      before_hash: hash(before),
      after_hash: hash(entity)
    }];
  },

  // WRITE: Aggregate (entity + children)
  async save_aggregate(data: DomainResult<{Entity}>): Promise<WriteResult[]> {
    if (!data.entity) {
      throw new Error("Repository requires entity");
    }

    const entity = data.entity;
    const before = await this.get_by_id(entity.id);

    const batch = firestore.batch();
    batch.set(doc_ref(entity.id), entity);

    // Child entities (same aggregate boundary)
    for (const child of entity.children) {
      batch.set(child_ref(child.id), child);
    }

    await batch.commit(); // ATOMIC

    return [{
      entity_type: "{entity}",
      entity_id: entity.id,
      operation: "replace",
      before_hash: hash(before),
      after_hash: hash(entity)
    }];
  },

  // READ: By ID
  async get_by_id(id: string): Promise<{Entity} | null> {
    const doc = await doc_ref(id).get();
    return doc.exists ? map_to_domain(doc.data()) : null;
  },

  // READ: By user
  async get_by_user_id(user_id: string): Promise<{Entity}[]> {
    const snapshot = await firestore
      .collection(COLLECTION)
      .where("user_id", "==", user_id)
      .get();
    return snapshot.docs.map(doc => map_to_domain(doc.data()));
  },

  // READ: Query
  async query(params: QueryParams): Promise<{Entity}[]> {
    let query = firestore.collection(COLLECTION);

    if (params.user_id) {
      query = query.where("user_id", "==", params.user_id);
    }
    if (params.category) {
      query = query.where("category", "==", params.category);
    }

    const snapshot = await query.get();
    return snapshot.docs.map(doc => map_to_domain(doc.data()));
  }
};

// Map Firestore → Domain
function map_to_domain(data: any): {Entity} {
  return {
    id: data.id,
    // ... field mappings
  };
}
```

---

## 7. Edge Case Handling

### 7.1 Idempotency

| Scenario | Behavior |
|----------|----------|
| Duplicate request (complete) | Return cached result |
| Duplicate request (in-progress) | Return 409 Conflict |
| Key expired (>24h) | Treat as new request |
| Key collision | UUID v4 prevents this |

### 7.2 Performance Budget

| Scenario | Behavior |
|----------|----------|
| Budget exceeded | Return partial result + `processing_background: true` |
| Near budget | Continue, log warning |
| Way over budget | Indicates design problem, investigate |

### 7.3 Job Failures

| Scenario | Behavior |
|----------|----------|
| Job fails once | Retry with exponential backoff |
| Job fails max retries | Move to DLQ, send alert |
| DLQ grows | Investigate root cause |

### 7.4 Concurrent Access

| Scenario | Behavior |
|----------|----------|
| Same idempotency key | 409 Conflict |
| Same entity, different keys | Both proceed, last write wins |
| Aggregate boundary conflict | Firestore transaction handles |

### 7.5 Data Handling

| Scenario | Behavior |
|----------|----------|
| Timezone in input | Convert to UTC at Entry layer |
| Partial batch write | IMPOSSIBLE - atomic only |
| Missing required field | Validation error at Entry |
| Invalid type | Validation error at Entry |

---

## 8. Testing Requirements

### 8.1 Domain Services (Unit Tests)

```typescript
describe("compute_{entity}", () => {
  it("computes correctly with valid input", () => {
    const result = compute_{entity}(valid_input);
    expect(result.entity).toBeDefined();
    expect(result.entity.total).toBe(expected_total);
  });

  it("returns validation error for invalid input", () => {
    const result = compute_{entity}(invalid_input);
    expect(result.validation_errors).toContain("Expected error");
  });

  it("is deterministic - same input produces same output", () => {
    const result_1 = compute_{entity}(input);
    const result_2 = compute_{entity}(input);
    expect(result_1).toEqual(result_2);
  });
});
```

### 8.2 Repositories (Integration Tests)

```typescript
describe("{entity}_repo", () => {
  it("saves and retrieves entity", async () => {
    await {entity}_repo.save({ entity: test_entity });
    const retrieved = await {entity}_repo.get_by_id(test_entity.id);
    expect(retrieved).toEqual(test_entity);
  });

  it("returns WriteResult with hashes", async () => {
    const results = await {entity}_repo.save({ entity: test_entity });
    expect(results[0].entity_type).toBe("{entity}");
    expect(results[0].before_hash).toBeDefined();
    expect(results[0].after_hash).toBeDefined();
  });

  it("batch is atomic - all or nothing", async () => {
    // Test that partial failures don't leave partial state
  });
});
```

### 8.3 Orchestrators (Integration Tests)

```typescript
describe("{operation}_{entity}_orchestrator", () => {
  it("returns cached result for duplicate idempotency key", async () => {
    const ctx = create_test_context();
    const result_1 = await {operation}_{entity}_orchestrator(ctx);
    const result_2 = await {operation}_{entity}_orchestrator(ctx);
    expect(result_1).toEqual(result_2);
    // Verify only one write occurred
  });

  it("emits event on success", async () => {
    const ctx = create_test_context();
    await {operation}_{entity}_orchestrator(ctx);
    expect(event_bus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "{entity}.{operation}d" })
    );
  });

  it("propagates trace_id through all layers", async () => {
    const ctx = create_test_context();
    await {operation}_{entity}_orchestrator(ctx);
    // Verify trace_id in logs, events, jobs
  });
});
```

### 8.4 Entry (E2E Tests)

```typescript
describe("{operation}_{entity} entry", () => {
  it("returns unauthenticated for missing auth", async () => {
    const result = await call_function({ data: valid_data });
    expect(result.error.code).toBe("unauthenticated");
  });

  it("returns validation error for invalid input", async () => {
    const result = await call_function({ auth, data: invalid_data });
    expect(result.error.code).toBe("invalid-argument");
  });

  it("includes trace_id in all responses", async () => {
    const result = await call_function({ auth, data: valid_data });
    expect(result.trace_id).toBeDefined();
  });

  it("returns 409 for concurrent idempotency key", async () => {
    // Start two requests with same key
    // Verify one returns 409
  });
});
```

---

## 9. Checklist

### Before Implementation

- [ ] Read this entire document
- [ ] Identify domain and operation
- [ ] Check for existing similar functions
- [ ] Define input/output types

### Layer Implementation

- [ ] **Types**: Input, Output, Entity types defined
- [ ] **Domain**: Pure function, no async, no IO
- [ ] **Domain**: Returns DomainResult (not throws)
- [ ] **Domain**: Unit tests pass
- [ ] **Repository**: Uses atomic batches
- [ ] **Repository**: Returns WriteResult
- [ ] **Repository**: No business logic
- [ ] **Resolver**: Read-only, no mutations
- [ ] **Resolver**: Lookup logic only, no business logic
- [ ] **Orchestrator**: Idempotency check first
- [ ] **Orchestrator**: Performance budget tracked
- [ ] **Orchestrator**: Events emitted
- [ ] **Orchestrator**: Jobs enqueued if needed
- [ ] **Orchestrator**: Async logging
- [ ] **Entry**: Auth check first
- [ ] **Entry**: Input validation complete
- [ ] **Entry**: Trace context created
- [ ] **Entry**: Calls exactly ONE orchestrator
- [ ] **Entry**: Response includes trace_id

### Testing

- [ ] Domain service unit tests
- [ ] Repository integration tests
- [ ] Orchestrator integration tests
- [ ] Entry E2E tests
- [ ] Idempotency test
- [ ] Concurrent request test
- [ ] Error handling tests

### Final Verification

- [ ] No layer skipping
- [ ] No business logic outside domain
- [ ] No direct Firestore outside repository
- [ ] Trace propagates through all layers
- [ ] All responses include trace_id
- [ ] Performance budget defined
- [ ] All naming follows snake_case convention (ESLint enforced)

---

## Observability Constraints

### Performance Targets

| Metric | Target |
|--------|--------|
| Sync logging overhead | < 5ms |
| Handler execution | < 100ms (offload heavy work to jobs) |

### fire_and_forget Implementation

The `fire_and_forget` helper MUST swallow errors to prevent logging failures from affecting business execution:

```typescript
function fire_and_forget(fn: () => Promise<void>): void {
  fn().catch(() => {
    // Swallow errors - logging failures MUST NOT affect business execution
  });
}
```

### Tier 2 Logging Activation

Tier 2 (async debug) logs are ONLY enabled when:
- `debug_mode === true`
- An error occurs
- A retry occurs
- Sampling condition is met (e.g., 1%)

### Layer-Specific Logging Rules

| Layer | Logging Requirements |
|-------|---------------------|
| Entry | Log request received, response returned |
| Orchestrator | Log decisions, dependency results, idempotency outcomes |
| Resolver | Log read sources, affected_entities |
| Domain | **NO logging** (pure function) |
| Repository | Log writes (required), reads only in debug mode |
| Event Handler | Log event received, job/orchestrator triggered |

---

## Robustness Infrastructure

### Circuit Breaker Pattern

Wrap external service calls to prevent cascade failures:

```typescript
// /src/functions/infrastructure/circuit_breaker.ts

interface CircuitBreakerState {
  status: "closed" | "open" | "half-open";
  failure_count: number;
  last_failure: Timestamp | null;
  next_attempt: Timestamp | null;
}

// Usage in integration client:
export async function get_transactions(...) {
  return with_circuit_breaker("plaid", async () => {
    return plaid_api.transactionsGet(...);
  });
}
```

**States:** `closed` (normal) → `open` (fast-fail) → `half-open` (test one request)

### Health Check Endpoint

```typescript
// /src/functions/entry/http/health.entry.ts

export const health_check = onRequest(async (req, res) => {
  const checks = {
    firestore: await check_firestore_connectivity(),
    plaid: await check_circuit_breaker_status("plaid"),
    cloud_tasks: await check_queue_health(),
  };

  const healthy = Object.values(checks).every(c => c.status === "healthy");
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "degraded",
    components: checks,
    timestamp: new Date().toISOString(),
  });
});
```

### Audit Trail

All repository writes automatically create audit entries:

```typescript
// /src/functions/audit/audit.types.ts

interface AuditEntry {
  audit_id: string;
  timestamp: Timestamp;
  user_id: string;
  action: "create" | "update" | "delete";
  entity_type: string;
  entity_id: string;
  before: object | null;
  after: object | null;
  trace_id: string;
}

// Collection: _audit (append-only, never deleted)
```

### Feature Flags

```typescript
// /src/functions/infrastructure/feature_flags.ts

// Check in orchestrator:
if (await feature_flags.is_enabled("new_budget_calc", user_id)) {
  return compute_budget_v2(input);
}

// Supports:
// - enabled: boolean (on/off)
// - rollout_percentage: number (0-100 for gradual rollout)
// - user_allowlist: string[] (specific users for testing)
```

### Graceful Degradation

| Component Down | Degraded Behavior |
|----------------|-------------------|
| Plaid API | Return cached balances with `stale_since` timestamp |
| Cloud Tasks | Execute sync, skip async jobs, log warning |
| Logging service | Continue operation, drop logs |

### Timeout Wrapper

```typescript
// /src/functions/infrastructure/timeout.ts

const TIMEOUTS = {
  plaid_api: 30_000,
  firestore_read: 5_000,
  firestore_write: 10_000,
};

const result = await with_timeout(
  plaid_client.get_transactions(...),
  TIMEOUTS.plaid_api,
  "Plaid API timeout"
);
```

### Rate Limiting

```typescript
// Check at Entry layer:
const allowed = await rate_limiter.check(user_id, "write");
if (!allowed) {
  throw new HttpsError("resource-exhausted", "Too many requests");
}

// Limits: 30 writes/min, 100 reads/min per user
```

---

## 12. Configuration Management

### Configuration Hierarchy

```
┌───────────────────────────────────────────────────────┐
│                 CONFIGURATION SOURCES                  │
├───────────────────────────────────────────────────────┤
│ 1. SECRETS (Google Secret Manager)                    │
│    - Plaid API keys, encryption keys                  │
│    - Access: Secret Manager SDK                       │
│    - Propagation: Immediate on next invocation        │
│                                                        │
│ 2. ENVIRONMENT VARIABLES (Firebase Functions Config)  │
│    - Environment identifier, service URLs             │
│    - Set: firebase functions:config:set               │
│    - Propagation: Requires deploy                     │
│                                                        │
│ 3. RUNTIME CONFIG (Firestore _config collection)      │
│    - Performance budgets, timeouts, rate limits       │
│    - Access: Cached, refresh every 5 minutes          │
│    - Propagation: 5 minutes (cache TTL)               │
│                                                        │
│ 4. FEATURE FLAGS (Firestore _feature_flags)           │
│    - Canary rollouts, kill switches                   │
│    - Access: feature_flags.is_enabled()               │
│    - Propagation: 1 minute (cache TTL)                │
└───────────────────────────────────────────────────────┘
```

### Runtime Config Access

```typescript
// /src/functions/infrastructure/config.ts

interface RuntimeConfig {
  performance_budgets: {
    default: PerformanceBudget;
    [key: string]: PerformanceBudget;
  };
  rate_limits: RateLimitConfig;
  timeouts: TimeoutConfig;
  circuit_breaker: CircuitBreakerConfig;
}

let cached_config: RuntimeConfig | null = null;
let cache_timestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function get_config(): Promise<RuntimeConfig> {
  if (cached_config && Date.now() - cache_timestamp < CACHE_TTL_MS) {
    return cached_config;
  }

  const doc = await firestore().collection("_config").doc("defaults").get();
  cached_config = doc.data() as RuntimeConfig;
  cache_timestamp = Date.now();
  return cached_config;
}

// Usage in orchestrator:
const config = await get_config();
const budget = config.performance_budgets[operation_name]
  ?? config.performance_budgets.default;
```

### Which Config Type for What

| Config Item | Where | Why |
|-------------|-------|-----|
| API keys, secrets | Secret Manager | Security, rotation support |
| Environment name | Environment Variable | Static, deploy-time |
| Service URLs | Environment Variable | Static, per-environment |
| Performance budgets | Runtime Config | Tunable without deploy |
| Rate limits | Runtime Config | Tunable without deploy |
| Timeouts | Runtime Config | Tunable without deploy |
| Feature rollouts | Feature Flags | Instant toggling |
| Kill switches | Feature Flags | Emergency response |

---

## 13. Operational Requirements

### Monitoring Dashboard

Track these metrics in Google Cloud Monitoring:

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| p50 latency | < 100ms | > 200ms |
| p95 latency | < 300ms | > 500ms |
| p99 latency | < 500ms | > 1000ms |
| Error rate (5xx) | < 0.1% | > 1% |
| Firestore quota | < 80% | > 80% warn, > 95% critical |
| DLQ size | 0 | > 0 (immediate) |

### Load Testing Thresholds

Before deploying major changes, verify:

| Metric | Baseline | Regression if |
|--------|----------|---------------|
| p50 latency | 80ms | > 120ms (+50%) |
| p95 latency | 250ms | > 375ms (+50%) |
| p99 latency | 400ms | > 600ms (+50%) |
| Error rate | 0.05% | > 0.5% (10x) |

### Emergency Rollback

```bash
# Via feature flag (instant):
# Firestore → _feature_flags → set enabled: false

# Via deployment (2-3 minutes):
firebase deploy --only functions --force

# Via console:
# Cloud Functions → Select function → Versions → Deploy previous
```

---

## Quick Decision Reference

| Question | Answer |
|----------|--------|
| Where does validation go? | Entry (schema) + Domain (business rules) |
| Where does auth go? | Entry only |
| Where do calculations go? | Domain only |
| Where do writes go? | Repository only |
| Where do jobs enqueue? | Orchestrator only |
| Can resolver write? | NO |
| Can domain have await? | NO |
| Can entry call repository? | NO |
| Can orchestrator call Firestore? | NO |
| Where do external API calls go? | Integration Client only |
| Where does external→domain conversion go? | Integration Transformer (PURE) |
| Can transformer have await? | NO (it's pure like domain) |
| Can client contain business logic? | NO (just fetch data) |
| Where do webhooks enter? | Entry (HTTP handler) |
| Can integration call repository? | NO (Orchestrator coordinates) |
| Where does circuit breaker go? | Integration Client (wraps API calls) |
| Where does rate limiting go? | Entry layer |
| Where does audit logging go? | Repository layer (automatic) |
| Where do feature flag checks go? | Orchestrator |
| Where do API keys go? | Google Secret Manager |
| Where do tunable values go? | Runtime Config (_config collection) |
| How to rollback instantly? | Feature flags (disable canary) |
| How to rollback deploy? | firebase deploy --force or Console |

---

*Last updated: 2026-05-16*
*Version: 1.4*
