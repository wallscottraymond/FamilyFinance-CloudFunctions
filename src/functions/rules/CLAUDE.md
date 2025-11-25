# Rules System - Cloud Functions

## ⚠️ RBAC System Migration (2025-01)

**IMPORTANT**: The Rules System will be updated to support the new RBAC (Role-Based Access Control) and group-based sharing system.

### Upcoming Changes:
- **CategoryRule interface** will add ownership and sharing fields (`createdBy`, `ownerId`, `sharing`)
- Rules can be shared with groups for collaborative rule management
- Legacy `familyId` field will remain for backward compatibility
- **Security rules** will validate resource-level permissions
- **Cloud Functions** will check SystemRole capabilities before rule operations

### Current Status:
- Phase 1 (Types) completed - Backend types updated in `/src/types/`
- Phase 2 (Resource Updates) in progress - Rules interface needs updating
- See `/RBAC_IMPLEMENTATION_STATUS.md` for detailed migration status

### For Detailed Architecture:
- See main `/CLAUDE.md` for RBAC system architecture
- Review `/src/types/sharing.ts` for sharing interfaces
- Check `/src/types/users.ts` for system role capabilities

---

## Overview

The Rules System is a powerful transaction categorization engine that enables users to create custom rules for automatically categorizing, tagging, and modifying transactions. Built on a **rules-based recalculation architecture**, the system preserves original Plaid data immutably while computing current transaction state by applying user-defined rules.

### Core Concept: Computed State from Immutable Data

**Rules transform transactions without duplicating data:**
- Original Plaid data stored immutably in `plaidData` field
- Current transaction state is **computed** by applying active rules
- Rules can be reverted by simply disabling them and recalculating
- No duplicate transactions needed - single source of truth

**Example:**
```typescript
// Original Plaid Data (immutable)
plaidData: {
  merchantName: "Smiths Gas",
  category: "FOOD_AND_DRINK_GROCERIES",
  amount: 45.00
}

// User creates rule: "Smiths Gas → Transportation"
// Computed Current State (after rule application)
{
  category: "TRANSPORTATION_GAS",  // Modified by rule
  appliedRules: ["rule_smiths_gas"],
  isRuleModified: true,
  metadata: {
    categorySource: "rule",
    primaryRuleId: "rule_smiths_gas"
  }
}

// User reverts rule
// Computed Current State (back to original)
{
  category: "FOOD_AND_DRINK_GROCERIES",  // Back to Plaid original
  appliedRules: [],
  isRuleModified: false,
  metadata: {
    categorySource: "plaid"
  }
}
```

## Architecture

### Module Structure

```
rules/
├── CLAUDE.md                    # This comprehensive documentation
├── api/                         # Public-facing Cloud Functions
│   ├── crud/                    # Create, Read, Update, Delete rules
│   │   ├── createRule.ts
│   │   ├── updateRule.ts
│   │   ├── deleteRule.ts
│   │   └── listRules.ts
│   └── operations/              # Rule operations
│       ├── applyRule.ts         # Apply rule to transactions
│       ├── revertRule.ts        # Revert/disable rule
│       ├── previewRule.ts       # Preview rule impact
│       └── testRule.ts          # Test rule against sample data
├── orchestration/               # Background automation
│   └── triggers/                # Firestore triggers
│       ├── onRuleCreated.ts     # Auto-apply new rules retroactively
│       ├── onRuleUpdated.ts     # Re-apply modified rules
│       └── onTransactionCreated.ts # Apply rules to new transactions
├── utils/                       # Shared business logic
│   ├── ruleEngine.ts            # Core rule evaluation engine
│   ├── ruleMatching.ts          # Condition matching logic
│   ├── ruleApplication.ts       # Apply rules to transactions
│   ├── ruleValidation.ts        # Validate rule syntax
│   └── transactionRecalculation.ts # Recalculate transaction state
├── types/                       # TypeScript type definitions
│   └── ruleTypes.ts             # Rule-specific interfaces
├── config/                      # Configuration constants
│   └── ruleConfig.ts            # Rule system configuration
└── admin/                       # Admin and testing functions
    ├── migrateToRulesSystem.ts  # Migration script
    └── debugRules.ts            # Debug rule application
```

### Key Principles

1. **Immutability**: Original Plaid data never modified
2. **Computed State**: Transaction fields derived from plaidData + rules
3. **Retroactive Application**: Rules apply to past and future transactions
4. **Easy Revert**: Disable rule → recalculate → back to original
5. **Transparency**: Users can see which rules modified which fields
6. **Performance**: Caching and optimization for fast evaluation
7. **Scalability**: Supports complex boolean logic and rule chains

## Why This Approach?

### Alternative 1: Duplicate Transactions ❌
**How it works:** Keep two copies - original and modified
**Problems:**
- 2x storage cost
- Data synchronization issues
- What if Plaid updates the original?
- Complexity managing two copies

### Alternative 2: Transaction History ⚠️
**How it works:** Store change history in subcollection
**Problems:**
- Can only revert to specific snapshots
- History grows over time
- Requires querying subcollections for revert
- Doesn't support retroactive rule changes

### Our Approach: Rules-Based Recalculation ✅
**How it works:** Store original data + rules, compute current state
**Benefits:**
- ✅ Single source of truth (original data)
- ✅ Revert = disable rule, recalculate
- ✅ Rule changes apply retroactively to all transactions
- ✅ No duplicate data
- ✅ Complete audit trail
- ✅ Scalable and performant

## Data Models

### CategoryRule Interface

```typescript
interface CategoryRule extends BaseDocument {
  // Ownership
  userId: string;              // Rule owner
  familyId?: string;           // Future: family-shared rules

  // Rule identification
  name: string;                // "Gas Stations → Transportation"
  description?: string;        // "Categorize all gas station purchases"

  // Boolean logic conditions
  conditions: RuleConditions;

  // Actions to apply when conditions match
  actions: RuleActions;

  // Rule metadata
  isActive: boolean;           // Is rule currently active?
  priority: number;            // Evaluation priority (higher = first)
  matchCount: number;          // How many transactions matched
  lastAppliedAt?: Timestamp;   // Last application timestamp

  // Conflict detection
  conflictsWith?: string[];    // Other rule IDs that conflict

  // Testing and preview
  isTestMode?: boolean;        // For testing before activation
  lastTestedAt?: Timestamp;
  testResults?: RuleTestResults;

  // Timestamps
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### RuleConditions (Boolean Logic Structure)

```typescript
interface RuleConditions {
  // Top-level operator
  operator: 'AND' | 'OR';      // How to combine condition groups

  // Array of condition groups
  conditionGroups: ConditionGroup[];
}

interface ConditionGroup {
  operator: 'AND' | 'OR';      // How to combine conditions in this group
  conditions: RuleCondition[]; // Array of individual conditions
  nested?: ConditionGroup[];   // Optional nested groups for complex logic
}

interface RuleCondition {
  field: RuleConditionField;   // What field to check
  condition: StringCondition | NumberRange | DateRange | CategoryCondition | ArrayCondition;
}

type RuleConditionField =
  | 'merchantName'
  | 'description'
  | 'amount'
  | 'date'
  | 'plaidCategory'
  | 'plaidDetailedCategory'
  | 'dayOfWeek'
  | 'tags';
```

### Condition Types

**String Conditions:**
```typescript
interface StringCondition {
  type: 'string';
  equals?: string;             // Exact match
  contains?: string;           // Substring match
  startsWith?: string;         // Prefix match
  endsWith?: string;           // Suffix match
  regex?: string;              // Regular expression (advanced)
  caseSensitive: boolean;      // Case-sensitive matching
}
```

**Number Conditions:**
```typescript
interface NumberRange {
  type: 'number';
  equals?: number;             // Exact value
  min?: number;                // Minimum value (inclusive)
  max?: number;                // Maximum value (inclusive)
  notEquals?: number;          // Exclusion
}
```

**Date Conditions:**
```typescript
interface DateRange {
  type: 'date';
  before?: Timestamp;          // Before specific date
  after?: Timestamp;           // After specific date
  between?: {                  // Date range
    start: Timestamp;
    end: Timestamp;
  };
  relative?: RelativeDateCondition; // Relative to current date
}

interface RelativeDateCondition {
  unit: 'days' | 'weeks' | 'months' | 'years';
  value: number;
  direction: 'past' | 'future';
  // Example: { unit: 'months', value: 3, direction: 'past' } = last 3 months
}
```

**Category Conditions:**
```typescript
interface CategoryCondition {
  type: 'category';
  exactMatch?: string;         // Exact category match
  primaryMatch?: string;       // Match primary category
  includes?: string[];         // Must include one of these
  excludes?: string[];         // Must not include any of these
}
```

**Array Conditions:**
```typescript
interface ArrayCondition {
  type: 'array';
  includes?: string[];         // Must include all (AND)
  excludes?: string[];         // Must exclude all
  includesAny?: string[];      // Must include at least one (OR)
  includesAll?: string[];      // Must include all (AND)
}
```

### RuleActions

```typescript
interface RuleActions {
  setCategory?: string;        // Set transaction category
  addTags?: string[];          // Add tags to transaction
  removeTags?: string[];       // Remove tags from transaction
  setNote?: string;            // Set transaction note
  appendNote?: string;         // Append to existing note
  setBudget?: string;          // Assign to budget (future)
  // Future: modify splits, set flags, etc.
}
```

### Transaction Rule Tracking

```typescript
interface Transaction {
  // ... existing fields ...

  // Original immutable Plaid data
  plaidData: {
    category: string;
    detailedCategory?: string;
    primaryCategory?: string;
    merchantName?: string;
    amount: number;
    date: Timestamp;
    description: string;
    pending: boolean;
    personalFinanceCategory?: {
      primary: string;
      detailed: string;
      confidenceLevel?: string;
    };
  };

  // Rule application tracking
  appliedRules: string[];          // Rule IDs currently applied
  isRuleModified: boolean;         // Any rule modified this?
  lastRuleApplication: Timestamp;  // Last application time
  ruleApplicationCount: number;    // Total applications

  // Metadata additions
  metadata: {
    categorySource: 'plaid' | 'rule' | 'manual';
    primaryRuleId?: string;
    originalPlaidCategory: string;
    ruleHistory?: {
      appliedAt: Timestamp;
      ruleId: string;
      changes: string[];
    }[];
  };
}
```

### Rule Application History (Subcollection)

```typescript
// transactions/{transactionId}/rule_history/{historyId}
interface RuleApplicationHistory extends BaseDocument {
  ruleId: string;              // Which rule was applied
  transactionId: string;       // Which transaction
  appliedAt: Timestamp;        // When
  appliedBy: string;           // User ID or "system"
  changes: RuleChange[];       // What changed
  wasAutomatic: boolean;       // Auto vs manual application
}

interface RuleChange {
  field: string;               // Field that changed
  oldValue: any;               // Previous value
  newValue: any;               // New value
  action: string;              // Action type
}
```

## Boolean Logic System

### Overview

The rules system supports complex boolean logic with nested AND/OR operators, allowing users to create sophisticated matching conditions.

**Key Features:**
- AND/OR operators at multiple levels
- Nested condition groups
- Short-circuit evaluation for performance
- Unlimited nesting depth (recommended max: 3)
- Visual representation in UI

### Simple Examples

**Example 1: Simple OR - "Smiths Gas OR Walmart"**
```typescript
{
  operator: 'OR',
  conditionGroups: [
    {
      operator: 'AND',
      conditions: [
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'smiths gas',
            caseSensitive: false
          }
        }
      ]
    },
    {
      operator: 'AND',
      conditions: [
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'walmart',
            caseSensitive: false
          }
        }
      ]
    }
  ]
}
```

**Example 2: Simple AND - "Smiths AND amount > $50"**
```typescript
{
  operator: 'AND',
  conditionGroups: [
    {
      operator: 'AND',
      conditions: [
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'smiths',
            caseSensitive: false
          }
        },
        {
          field: 'amount',
          condition: {
            type: 'number',
            min: 50
          }
        }
      ]
    }
  ]
}
```

### Complex Examples

**Example 3: Complex AND/OR - "(Smiths AND > $50) OR (Shell AND Groceries)"**

**Rule Description:** Match transactions that are either:
- From Smiths with amount over $50, OR
- From Shell and categorized as groceries

```typescript
{
  operator: 'OR',
  conditionGroups: [
    {
      operator: 'AND',
      conditions: [
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'smiths',
            caseSensitive: false
          }
        },
        {
          field: 'amount',
          condition: {
            type: 'number',
            min: 50
          }
        }
      ]
    },
    {
      operator: 'AND',
      conditions: [
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'shell',
            caseSensitive: false
          }
        },
        {
          field: 'plaidCategory',
          condition: {
            type: 'category',
            includes: ['FOOD_AND_DRINK_GROCERIES']
          }
        }
      ]
    }
  ]
}
```

**Example 4: Triple Condition - "Gas stations on weekends over $40"**

**Rule Description:** Match transactions that are:
- From gas stations (Smiths, Chevron, or Shell), AND
- On weekends (Saturday or Sunday), AND
- Amount over $40

```typescript
{
  operator: 'AND',
  conditionGroups: [
    {
      operator: 'OR',  // Any of these gas stations
      conditions: [
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'smiths gas',
            caseSensitive: false
          }
        },
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'chevron',
            caseSensitive: false
          }
        },
        {
          field: 'merchantName',
          condition: {
            type: 'string',
            contains: 'shell',
            caseSensitive: false
          }
        }
      ]
    },
    {
      operator: 'AND',  // Weekend days
      conditions: [
        {
          field: 'dayOfWeek',
          condition: {
            type: 'array',
            includesAny: [0, 6]  // Sunday = 0, Saturday = 6
          }
        }
      ]
    },
    {
      operator: 'AND',  // Amount threshold
      conditions: [
        {
          field: 'amount',
          condition: {
            type: 'number',
            min: 40
          }
        }
      ]
    }
  ]
}
```

**Example 5: Nested Groups - "((A AND B) OR (C AND D)) AND E"**

**Rule Description:** Match transactions where:
- Either (Smiths over $50) OR (Walmart groceries), AND
- In the last 30 days

```typescript
{
  operator: 'AND',
  conditionGroups: [
    {
      operator: 'OR',  // First complex group
      conditions: [],
      nested: [
        {
          operator: 'AND',
          conditions: [
            {
              field: 'merchantName',
              condition: { type: 'string', contains: 'smiths', caseSensitive: false }
            },
            {
              field: 'amount',
              condition: { type: 'number', min: 50 }
            }
          ]
        },
        {
          operator: 'AND',
          conditions: [
            {
              field: 'merchantName',
              condition: { type: 'string', contains: 'walmart', caseSensitive: false }
            },
            {
              field: 'plaidCategory',
              condition: { type: 'category', includes: ['FOOD_AND_DRINK_GROCERIES'] }
            }
          ]
        }
      ]
    },
    {
      operator: 'AND',  // Date restriction
      conditions: [
        {
          field: 'date',
          condition: {
            type: 'date',
            relative: {
              unit: 'days',
              value: 30,
              direction: 'past'
            }
          }
        }
      ]
    }
  ]
}
```

### Boolean Logic Evaluation

**Evaluation Algorithm (Pseudo-Code):**

```typescript
function evaluateRule(transaction: Transaction, rule: CategoryRule): boolean {
  return evaluateConditions(transaction, rule.conditions);
}

function evaluateConditions(transaction: Transaction, conditions: RuleConditions): boolean {
  const results = conditions.conditionGroups.map(group =>
    evaluateConditionGroup(transaction, group)
  );

  if (conditions.operator === 'AND') {
    return results.every(result => result === true);
  } else {
    return results.some(result => result === true);
  }
}

function evaluateConditionGroup(transaction: Transaction, group: ConditionGroup): boolean {
  // Evaluate direct conditions
  const conditionResults = group.conditions.map(condition =>
    evaluateCondition(transaction, condition)
  );

  // Evaluate nested groups
  const nestedResults = (group.nested || []).map(nestedGroup =>
    evaluateConditionGroup(transaction, nestedGroup)
  );

  // Combine results
  const allResults = [...conditionResults, ...nestedResults];

  if (group.operator === 'AND') {
    return allResults.every(result => result === true);
  } else {
    return allResults.some(result => result === true);
  }
}

function evaluateCondition(transaction: Transaction, condition: RuleCondition): boolean {
  const fieldValue = getTransactionField(transaction, condition.field);

  switch (condition.condition.type) {
    case 'string':
      return matchStringCondition(fieldValue, condition.condition);
    case 'number':
      return matchNumberRange(fieldValue, condition.condition);
    case 'date':
      return matchDateRange(fieldValue, condition.condition);
    case 'category':
      return matchCategoryCondition(fieldValue, condition.condition);
    case 'array':
      return matchArrayCondition(fieldValue, condition.condition);
  }
}
```

**Short-Circuit Optimization:**

```typescript
// AND operator: Stop on first false
function evaluateAND(conditions): boolean {
  for (const condition of conditions) {
    if (!evaluate(condition)) {
      return false;  // Short-circuit: no need to evaluate remaining
    }
  }
  return true;
}

// OR operator: Stop on first true
function evaluateOR(conditions): boolean {
  for (const condition of conditions) {
    if (evaluate(condition)) {
      return true;  // Short-circuit: no need to evaluate remaining
    }
  }
  return false;
}
```

### Visual Representation

**Example Rule Tree:**
```
Rule: "Categorize Gas Stations"
├─ OR (top-level)
   ├─ AND (Group 1)
   │  ├─ merchantName contains "smiths gas"
   │  └─ amount > $50
   └─ AND (Group 2)
      ├─ merchantName contains "shell"
      └─ category = "GROCERIES"
```

**UI Representation:**
```
┌─────────────────────────────────────────────────┐
│ Rule: "Gas Stations → Transportation"          │
├─────────────────────────────────────────────────┤
│ Match: ○ ALL conditions  ● ANY condition        │
├─────────────────────────────────────────────────┤
│ ┌─ Group 1 (AND) ────────────────────────────┐ │
│ │ ✓ Merchant contains "smiths gas"           │ │
│ │ ✓ Amount greater than $50                  │ │
│ └────────────────────────────────────────────┘ │
│                                                 │
│ ┌─ Group 2 (AND) ────────────────────────────┐ │
│ │ ✓ Merchant contains "shell"                │ │
│ │ ✓ Category equals "GROCERIES"              │ │
│ └────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ Action: Set category to "TRANSPORTATION"       │
├─────────────────────────────────────────────────┤
│ [Preview (47 transactions)] [Save Rule]        │
└─────────────────────────────────────────────────┘
```

## Rule Evaluation Engine

### Core Engine Architecture

The rule engine evaluates rules against transactions using a recursive algorithm that supports nested boolean logic, condition matching, and priority-based evaluation.

**Key Components:**
1. **Rule Matcher**: Determines which rules match a transaction
2. **Condition Evaluator**: Evaluates individual conditions
3. **Action Applier**: Applies rule actions to transaction
4. **Priority Resolver**: Handles conflicting rules
5. **Cache Manager**: Caches evaluation results

### Evaluation Flow

```typescript
/**
 * Main entry point: Apply rules to a transaction
 */
async function applyRulesToTransaction(
  transaction: Transaction,
  rules: CategoryRule[]
): Promise<Transaction> {
  // 1. Sort rules by priority (highest first)
  const sortedRules = rules
    .filter(rule => rule.isActive)
    .sort((a, b) => b.priority - a.priority);

  // 2. Evaluate each rule
  const matchingRules: CategoryRule[] = [];
  for (const rule of sortedRules) {
    if (await evaluateRule(transaction, rule)) {
      matchingRules.push(rule);
    }
  }

  // 3. Detect conflicts
  const conflicts = detectRuleConflicts(matchingRules);
  if (conflicts.length > 0) {
    console.warn('Rule conflicts detected:', conflicts);
    // Apply highest priority rule only
    matchingRules.splice(1);
  }

  // 4. Apply rule actions
  let modifiedTransaction = { ...transaction };
  for (const rule of matchingRules) {
    modifiedTransaction = await applyRuleActions(
      modifiedTransaction,
      rule.actions,
      rule.id!
    );
  }

  // 5. Update rule tracking
  modifiedTransaction.appliedRules = matchingRules.map(r => r.id!);
  modifiedTransaction.isRuleModified = matchingRules.length > 0;
  modifiedTransaction.lastRuleApplication = Timestamp.now();
  modifiedTransaction.ruleApplicationCount =
    (modifiedTransaction.ruleApplicationCount || 0) + 1;

  return modifiedTransaction;
}
```

### Condition Matching Logic

```typescript
/**
 * String condition matching
 */
function matchStringCondition(
  value: string,
  condition: StringCondition
): boolean {
  const compareValue = condition.caseSensitive
    ? value
    : value.toLowerCase();

  if (condition.equals) {
    const target = condition.caseSensitive
      ? condition.equals
      : condition.equals.toLowerCase();
    return compareValue === target;
  }

  if (condition.contains) {
    const target = condition.caseSensitive
      ? condition.contains
      : condition.contains.toLowerCase();
    return compareValue.includes(target);
  }

  if (condition.startsWith) {
    const target = condition.caseSensitive
      ? condition.startsWith
      : condition.startsWith.toLowerCase();
    return compareValue.startsWith(target);
  }

  if (condition.endsWith) {
    const target = condition.caseSensitive
      ? condition.endsWith
      : condition.endsWith.toLowerCase();
    return compareValue.endsWith(target);
  }

  if (condition.regex) {
    const flags = condition.caseSensitive ? '' : 'i';
    const regex = new RegExp(condition.regex, flags);
    return regex.test(value);
  }

  return false;
}

/**
 * Number range matching
 */
function matchNumberRange(
  value: number,
  condition: NumberRange
): boolean {
  if (condition.equals !== undefined) {
    return value === condition.equals;
  }

  if (condition.notEquals !== undefined) {
    return value !== condition.notEquals;
  }

  if (condition.min !== undefined && value < condition.min) {
    return false;
  }

  if (condition.max !== undefined && value > condition.max) {
    return false;
  }

  return true;
}

/**
 * Date range matching
 */
function matchDateRange(
  value: Timestamp,
  condition: DateRange
): boolean {
  const date = value.toDate();
  const now = new Date();

  if (condition.before) {
    if (date >= condition.before.toDate()) return false;
  }

  if (condition.after) {
    if (date <= condition.after.toDate()) return false;
  }

  if (condition.between) {
    const start = condition.between.start.toDate();
    const end = condition.between.end.toDate();
    if (date < start || date > end) return false;
  }

  if (condition.relative) {
    const relativeDate = calculateRelativeDate(now, condition.relative);
    if (condition.relative.direction === 'past') {
      if (date < relativeDate) return false;
    } else {
      if (date > relativeDate) return false;
    }
  }

  return true;
}
```

### Priority and Conflict Resolution

```typescript
/**
 * Detect conflicting rules
 */
function detectRuleConflicts(rules: CategoryRule[]): string[] {
  const conflicts: string[] = [];

  // Check for category conflicts
  const categoryActions = rules.filter(r => r.actions.setCategory);
  if (categoryActions.length > 1) {
    conflicts.push('Multiple rules attempting to set category');
  }

  // Check for predefined conflicts
  for (const rule of rules) {
    if (rule.conflictsWith) {
      const conflictingRules = rules.filter(r =>
        rule.conflictsWith!.includes(r.id!)
      );
      if (conflictingRules.length > 0) {
        conflicts.push(`Rule ${rule.id} conflicts with ${conflictingRules.map(r => r.id).join(', ')}`);
      }
    }
  }

  return conflicts;
}

/**
 * Resolve conflicts using priority
 */
function resolveConflicts(rules: CategoryRule[]): CategoryRule[] {
  // Sort by priority (highest first)
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  // Keep only highest priority rule for each action type
  const resolved: CategoryRule[] = [];
  const appliedActions = new Set<string>();

  for (const rule of sorted) {
    const actionTypes = Object.keys(rule.actions);
    const hasConflict = actionTypes.some(action => appliedActions.has(action));

    if (!hasConflict) {
      resolved.push(rule);
      actionTypes.forEach(action => appliedActions.add(action));
    }
  }

  return resolved;
}
```

### Caching Strategy

```typescript
/**
 * Rule evaluation cache
 */
interface RuleEvaluationCache {
  transactionId: string;
  ruleId: string;
  result: boolean;
  evaluatedAt: Timestamp;
  ttl: number;
}

/**
 * Check cache before evaluation
 */
async function evaluateRuleWithCache(
  transaction: Transaction,
  rule: CategoryRule
): Promise<boolean> {
  const cacheKey = `${transaction.id}:${rule.id}`;
  const cached = await getCachedEvaluation(cacheKey);

  if (cached && !isCacheExpired(cached)) {
    console.log(`Cache hit for ${cacheKey}`);
    return cached.result;
  }

  const result = await evaluateRule(transaction, rule);

  await cacheEvaluation(cacheKey, {
    transactionId: transaction.id!,
    ruleId: rule.id!,
    result,
    evaluatedAt: Timestamp.now(),
    ttl: 3600000  // 1 hour
  });

  return result;
}
```

## Rule Application Flow

### New Transaction from Plaid

```typescript
/**
 * Flow when Plaid transaction arrives
 */
async function processPlaidTransaction(plaidTxn: PlaidTransactionSync) {
  // 1. Store original Plaid data immutably
  const transaction: Transaction = {
    plaidData: {
      category: plaidTxn.category.join(','),
      detailedCategory: plaidTxn.personal_finance_category?.detailed,
      primaryCategory: plaidTxn.personal_finance_category?.primary,
      merchantName: plaidTxn.merchant_name,
      amount: plaidTxn.amount,
      date: Timestamp.fromDate(new Date(plaidTxn.date)),
      description: plaidTxn.name,
      pending: plaidTxn.pending,
      personalFinanceCategory: plaidTxn.personal_finance_category
    },

    // Initialize with Plaid values (before rules)
    category: plaidTxn.personal_finance_category?.detailed || 'OTHER_EXPENSE',
    merchantName: plaidTxn.merchant_name,
    description: plaidTxn.name,
    amount: Math.abs(plaidTxn.amount),

    // Rule tracking (empty initially)
    appliedRules: [],
    isRuleModified: false,
    ruleApplicationCount: 0,

    // ... other transaction fields
  };

  // 2. Fetch user's active rules
  const rules = await getUserRules(userId, { isActive: true });

  // 3. Apply rules to compute current state
  const processedTransaction = await applyRulesToTransaction(transaction, rules);

  // 4. Save to Firestore
  await db.collection('transactions').doc(plaidTxn.transaction_id).set(processedTransaction);

  // 5. Create rule application history
  if (processedTransaction.appliedRules.length > 0) {
    await createRuleApplicationHistory(processedTransaction);
  }

  console.log(`Transaction ${plaidTxn.transaction_id} processed with ${processedTransaction.appliedRules.length} rules`);
}
```

### User Creates New Rule

```typescript
/**
 * Flow when user creates a new rule
 */
async function handleRuleCreation(rule: CategoryRule) {
  // 1. Validate rule
  const validation = validateRule(rule);
  if (!validation.isValid) {
    throw new Error(`Invalid rule: ${validation.errors.join(', ')}`);
  }

  // 2. Save rule to Firestore
  const ruleRef = await db.collection('rules').add(rule);

  // 3. Preview impact (optional)
  const preview = await previewRuleImpact(ruleRef.id, rule);
  console.log(`Rule would affect ${preview.matchingCount} transactions`);

  // 4. Apply retroactively to existing transactions
  await applyRuleRetroactively(ruleRef.id, rule);

  // 5. Update rule statistics
  await ruleRef.update({
    matchCount: preview.matchingCount,
    lastAppliedAt: Timestamp.now()
  });

  return ruleRef.id;
}

/**
 * Apply rule to all existing transactions
 */
async function applyRuleRetroactively(ruleId: string, rule: CategoryRule) {
  const batchSize = 50;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let totalProcessed = 0;

  do {
    // Fetch batch of user's transactions
    let query = db.collection('transactions')
      .where('userId', '==', rule.userId)
      .limit(batchSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    // Process batch
    const batch = db.batch();
    for (const doc of snapshot.docs) {
      const transaction = doc.data() as Transaction;

      // Check if rule matches
      if (await evaluateRule(transaction, rule)) {
        // Recalculate transaction with new rule
        const allRules = await getUserRules(rule.userId, { isActive: true });
        const updated = await applyRulesToTransaction(transaction, allRules);

        batch.update(doc.ref, updated);
        totalProcessed++;
      }
    }

    await batch.commit();
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    // Delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));

  } while (lastDoc);

  console.log(`Applied rule ${ruleId} to ${totalProcessed} transactions`);
}
```

### User Reverts Rule

```typescript
/**
 * Flow when user reverts/deletes a rule
 */
async function handleRuleRevert(ruleId: string) {
  // 1. Get rule
  const ruleDoc = await db.collection('rules').doc(ruleId).get();
  if (!ruleDoc.exists) {
    throw new Error(`Rule ${ruleId} not found`);
  }

  const rule = ruleDoc.data() as CategoryRule;

  // 2. Disable rule (don't delete for history)
  await ruleDoc.ref.update({ isActive: false });

  // 3. Find all affected transactions
  const affectedTransactions = await db.collection('transactions')
    .where('appliedRules', 'array-contains', ruleId)
    .get();

  console.log(`Reverting ${affectedTransactions.size} transactions`);

  // 4. Recalculate each transaction without this rule
  const batchSize = 50;
  const batches: FirebaseFirestore.DocumentReference[][] = [];
  let currentBatch: FirebaseFirestore.DocumentReference[] = [];

  for (const doc of affectedTransactions.docs) {
    const transaction = doc.data() as Transaction;

    // Get remaining active rules
    const activeRules = await getUserRules(rule.userId, {
      isActive: true
    });

    // Recalculate from original Plaid data
    const recalculated = await applyRulesToTransaction(
      {
        ...transaction,
        // Reset to Plaid original
        category: transaction.plaidData.detailedCategory || 'OTHER_EXPENSE',
        merchantName: transaction.plaidData.merchantName,
        appliedRules: [],
        isRuleModified: false
      },
      activeRules
    );

    // Update transaction
    await doc.ref.update(recalculated);
    currentBatch.push(doc.ref);

    if (currentBatch.length >= batchSize) {
      batches.push(currentBatch);
      currentBatch = [];

      // Delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`Rule ${ruleId} reverted successfully`);
}
```

## API Functions Specifications

### CRUD Operations

#### createRule (Callable Function)
**Location:** `api/crud/createRule.ts`
**Auth:** User must be authenticated
**Purpose:** Create a new categorization rule

**Request:**
```typescript
interface CreateRuleRequest {
  name: string;
  description?: string;
  conditions: RuleConditions;
  actions: RuleActions;
  priority?: number;  // Default: 100
  applyRetroactively?: boolean;  // Default: true
  testFirst?: boolean;  // Preview before creating
}
```

**Response:**
```typescript
interface CreateRuleResponse {
  success: boolean;
  ruleId?: string;
  previewResults?: {
    matchingTransactions: number;
    sampleTransactions: string[];
  };
  message?: string;
}
```

**Example Usage:**
```typescript
const createRule = httpsCallable(functions, 'createRule');
const result = await createRule({
  name: "Gas Stations → Transportation",
  description: "Categorize all gas station purchases",
  conditions: {
    operator: 'OR',
    conditionGroups: [
      {
        operator: 'AND',
        conditions: [
          {
            field: 'merchantName',
            condition: {
              type: 'string',
              contains: 'smiths gas',
              caseSensitive: false
            }
          }
        ]
      }
    ]
  },
  actions: {
    setCategory: 'TRANSPORTATION_GAS'
  },
  priority: 100,
  applyRetroactively: true
});
```

#### updateRule (Callable Function)
**Location:** `api/crud/updateRule.ts`
**Auth:** User must be authenticated (rule owner)
**Purpose:** Modify existing rule

**Request:**
```typescript
interface UpdateRuleRequest {
  ruleId: string;
  updates: {
    name?: string;
    description?: string;
    conditions?: RuleConditions;
    actions?: RuleActions;
    priority?: number;
    isActive?: boolean;
  };
  reapplyToTransactions?: boolean;  // Re-apply to affected transactions
}
```

#### deleteRule (Callable Function)
**Location:** `api/crud/deleteRule.ts`
**Auth:** User must be authenticated (rule owner)
**Purpose:** Delete rule and optionally revert changes

**Request:**
```typescript
interface DeleteRuleRequest {
  ruleId: string;
  revertTransactions?: boolean;  // Recalculate affected transactions
  hardDelete?: boolean;  // Permanently delete vs soft delete
}
```

#### listRules (Callable Function)
**Location:** `api/crud/listRules.ts`
**Auth:** User must be authenticated
**Purpose:** Get user's rules with optional filtering

**Request:**
```typescript
interface ListRulesRequest {
  isActive?: boolean;  // Filter by active status
  sortBy?: 'priority' | 'createdAt' | 'matchCount';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
}
```

**Response:**
```typescript
interface ListRulesResponse {
  success: boolean;
  rules: CategoryRule[];
  totalCount: number;
}
```

### Rule Operations

#### previewRule (Callable Function)
**Location:** `api/operations/previewRule.ts`
**Auth:** User must be authenticated
**Purpose:** Preview rule impact without applying

**Request:**
```typescript
interface PreviewRuleRequest {
  conditions: RuleConditions;
  actions: RuleActions;
  sampleSize?: number;  // Max: 100
}
```

**Response:**
```typescript
interface PreviewRuleResponse {
  success: boolean;
  matchingCount: number;
  totalTransactions: number;
  sampleMatches: Array<{
    transactionId: string;
    description: string;
    currentCategory: string;
    newCategory: string;
    changes: string[];
  }>;
  estimatedImpact: string;
}
```

#### testRule (Callable Function)
**Location:** `api/operations/testRule.ts`
**Auth:** User must be authenticated
**Purpose:** Test rule against specific transactions

**Request:**
```typescript
interface TestRuleRequest {
  ruleId: string;
  transactionIds: string[];
}
```

**Response:**
```typescript
interface TestRuleResponse {
  success: boolean;
  results: Array<{
    transactionId: string;
    matched: boolean;
    appliedChanges?: RuleChange[];
  }>;
}
```

#### applyRule (Callable Function)
**Location:** `api/operations/applyRule.ts`
**Auth:** User must be authenticated (rule owner)
**Purpose:** Manually apply rule to specific transactions

**Request:**
```typescript
interface ApplyRuleRequest {
  ruleId: string;
  transactionIds?: string[];  // Specific transactions, or all if not provided
  forceReapply?: boolean;  // Apply even if already applied
}
```

#### revertRule (Callable Function)
**Location:** `api/operations/revertRule.ts`
**Auth:** User must be authenticated (rule owner)
**Purpose:** Disable rule and revert affected transactions

**Request:**
```typescript
interface RevertRuleRequest {
  ruleId: string;
  deleteRule?: boolean;  // Delete after reverting
}
```

**Response:**
```typescript
interface RevertRuleResponse {
  success: boolean;
  transactionsReverted: number;
  message?: string;
}
```

## Orchestration & Triggers

### onRuleCreated (Firestore Trigger)
**Location:** `orchestration/triggers/onRuleCreated.ts`
**Triggered by:** Document creation in `rules` collection
**Purpose:** Auto-apply new rules retroactively
**Memory:** 512MiB, Timeout: 180s

**Process:**
1. Rule created in Firestore
2. Trigger fires automatically
3. Fetch user's transactions
4. Evaluate rule against each transaction
5. Apply rule actions to matching transactions
6. Update rule statistics (matchCount, lastAppliedAt)
7. Create application history entries

### onRuleUpdated (Firestore Trigger)
**Location:** `orchestration/triggers/onRuleUpdated.ts`
**Triggered by:** Document update in `rules` collection
**Purpose:** Re-apply modified rules
**Memory:** 512MiB, Timeout: 180s

**Process:**
1. Rule modified in Firestore
2. Detect what changed (conditions, actions, priority)
3. Find previously affected transactions
4. Recalculate with new rule definition
5. Apply changes
6. Update statistics

### onTransactionCreated (Firestore Trigger)
**Location:** `orchestration/triggers/onTransactionCreated.ts`
**Triggered by:** Document creation in `transactions` collection
**Purpose:** Apply rules to new transactions
**Memory:** 256MiB, Timeout: 30s

**Process:**
1. New transaction created
2. Fetch user's active rules
3. Evaluate rules in priority order
4. Apply matching rules
5. Update transaction document
6. Create history entries

## Security & Permissions

### Firestore Security Rules

```javascript
// Rules collection
match /rules/{ruleId} {
  // Read: User can read own rules
  allow read: if request.auth != null &&
                 resource.data.userId == request.auth.uid;

  // Create: User can create own rules
  allow create: if request.auth != null &&
                   request.resource.data.userId == request.auth.uid &&
                   isValidRule();

  // Update: User can update own rules
  allow update: if request.auth != null &&
                   resource.data.userId == request.auth.uid &&
                   isValidRuleUpdate();

  // Delete: User can delete own rules
  allow delete: if request.auth != null &&
                   resource.data.userId == request.auth.uid;
}

// Validation functions
function isValidRule() {
  let data = request.resource.data;

  return data.keys().hasAll(['name', 'conditions', 'actions', 'isActive', 'priority']) &&
         data.name is string && data.name.size() > 0 && data.name.size() <= 100 &&
         data.conditions is map &&
         data.actions is map &&
         data.isActive is bool &&
         data.priority is int && data.priority >= 1 && data.priority <= 999;
}

function isValidRuleUpdate() {
  let data = request.resource.data;

  // Ensure userId doesn't change
  return data.userId == resource.data.userId &&
         isValidRule();
}
```

### Rule Application History Security

```javascript
// Rule application history (subcollection)
match /transactions/{transactionId}/rule_history/{historyId} {
  // Read: User can read history for own transactions
  allow read: if request.auth != null &&
                 get(/databases/$(database)/documents/transactions/$(transactionId)).data.userId == request.auth.uid;

  // Write: Only cloud functions can write
  allow create, update, delete: if false;
}
```

### Rate Limiting

**Rule Creation Limits:**
- Max 100 rules per user
- Max 10 rules created per hour
- Max 5 retroactive applications per hour

**API Call Limits:**
- Preview: 100 calls per hour
- Test: 50 calls per hour
- Apply/Revert: 20 calls per hour

## Performance Optimization

### Caching Strategies

**1. Rule Evaluation Cache:**
```typescript
// Cache rule evaluations for 1 hour
const CACHE_TTL = 3600000;

interface EvaluationCache {
  transactionId: string;
  ruleId: string;
  result: boolean;
  evaluatedAt: Timestamp;
}
```

**2. User Rules Cache:**
```typescript
// Cache user's rules in memory
const userRulesCache = new Map<string, CategoryRule[]>();

async function getUserRulesWithCache(userId: string): Promise<CategoryRule[]> {
  if (userRulesCache.has(userId)) {
    return userRulesCache.get(userId)!;
  }

  const rules = await fetchUserRules(userId);
  userRulesCache.set(userId, rules);

  // Invalidate after 5 minutes
  setTimeout(() => userRulesCache.delete(userId), 300000);

  return rules;
}
```

**3. Condition Matching Cache:**
```typescript
// Cache expensive operations (regex, date calculations)
const conditionCache = new Map<string, boolean>();

function matchWithCache(key: string, matcher: () => boolean): boolean {
  if (conditionCache.has(key)) {
    return conditionCache.get(key)!;
  }

  const result = matcher();
  conditionCache.set(key, result);
  return result;
}
```

### Batch Processing

**Retroactive Rule Application:**
```typescript
async function applyRuleInBatches(ruleId: string, rule: CategoryRule) {
  const BATCH_SIZE = 50;
  const DELAY_MS = 100;

  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let totalProcessed = 0;

  do {
    const batch = db.batch();
    let query = db.collection('transactions')
      .where('userId', '==', rule.userId)
      .limit(BATCH_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const transaction = doc.data() as Transaction;

      if (await evaluateRule(transaction, rule)) {
        const updated = await applyRuleActions(transaction, rule.actions, ruleId);
        batch.update(doc.ref, updated);
        totalProcessed++;
      }
    }

    await batch.commit();
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    // Delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, DELAY_MS));

  } while (lastDoc);

  return totalProcessed;
}
```

### Index-Friendly Queries

**Optimize for Firestore Indexes:**
```typescript
// Good: Uses index on userId + appliedRules
const query = db.collection('transactions')
  .where('userId', '==', userId)
  .where('appliedRules', 'array-contains', ruleId);

// Bad: Requires full collection scan
const query = db.collection('transactions')
  .where('metadata.categorySource', '==', 'rule');
```

**Required Indexes:**
```json
{
  "indexes": [
    {
      "collectionGroup": "transactions",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "appliedRules", "arrayConfig": "CONTAINS" }
      ]
    },
    {
      "collectionGroup": "transactions",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "isRuleModified", "order": "ASCENDING" },
        { "fieldPath": "lastRuleApplication", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "rules",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "isActive", "order": "ASCENDING" },
        { "fieldPath": "priority", "order": "DESCENDING" }
      ]
    }
  ]
}
```

### Short-Circuit Evaluation

**Optimize Boolean Logic:**
```typescript
// AND: Stop on first false
function evaluateAND(conditions: RuleCondition[]): boolean {
  for (const condition of conditions) {
    if (!evaluateCondition(condition)) {
      return false;  // Early exit
    }
  }
  return true;
}

// OR: Stop on first true
function evaluateOR(conditions: RuleCondition[]): boolean {
  for (const condition of conditions) {
    if (evaluateCondition(condition)) {
      return true;  // Early exit
    }
  }
  return false;
}
```

### Priority-Based Evaluation

**Evaluate High-Priority Rules First:**
```typescript
async function applyRulesOptimized(
  transaction: Transaction,
  rules: CategoryRule[]
): Promise<Transaction> {
  // Sort by priority (highest first)
  const sortedRules = rules.sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    // If high-priority rule matches, may not need to check others
    if (await evaluateRule(transaction, rule)) {
      if (rule.priority >= 900) {
        // Very high priority - apply and stop
        return applyRuleActions(transaction, rule.actions, rule.id!);
      }
    }
  }

  // Continue with remaining rules
  return applyAllMatchingRules(transaction, sortedRules);
}
```

## Document Size Analysis

### Current Transaction Size

**Existing Transaction (without rules):**
```typescript
{
  userId: "...",              // 20 bytes
  familyId: "...",            // 20 bytes
  amount: 45.00,              // 8 bytes
  currency: "USD",            // 3 bytes
  description: "...",         // ~50 bytes
  category: "...",            // ~30 bytes
  type: "expense",            // ~10 bytes
  date: Timestamp,            // 12 bytes
  splits: [...],              // ~300 bytes per split
  metadata: {...},            // ~200 bytes
  // ... other fields
}
// TOTAL: ~1-2 KB per transaction
```

**With Rules Support Added:**
```typescript
{
  // ... all existing fields (~1-2 KB)

  plaidData: {
    category: "...",          // 30 bytes
    detailedCategory: "...",  // 40 bytes
    merchantName: "...",      // 40 bytes
    amount: 45.00,            // 8 bytes
    date: Timestamp,          // 12 bytes
    description: "...",       // 40 bytes
    pending: false,           // 1 byte
    personalFinanceCategory: {
      primary: "...",         // 30 bytes
      detailed: "...",        // 40 bytes
    }
  },  // ~250 bytes

  appliedRules: ["rule1", "rule2"],  // ~40 bytes (20 per ID)
  isRuleModified: true,              // 1 byte
  lastRuleApplication: Timestamp,    // 12 bytes
  ruleApplicationCount: 5,           // 4 bytes

  metadata: {
    // ... existing metadata
    categorySource: "rule",          // 10 bytes
    primaryRuleId: "...",            // 20 bytes
    originalPlaidCategory: "...",    // 30 bytes
  }  // +60 bytes
}
// TOTAL: ~1.5-2.5 KB per transaction
```

**Size Increase: +350 bytes per transaction (~17-35% increase)**

### Firestore Limits

- **Maximum document size:** 1 MB (1,048,576 bytes)
- **Typical transaction with rules:** ~2.5 KB
- **Safety margin:** 400+ transactions worth of data per document
- **Verdict:** ✅ **COMPLETELY SAFE**

### History Subcollection

**Rule application history stored separately:**
```typescript
// transactions/{transactionId}/rule_history/{historyId}
interface RuleApplicationHistory {
  ruleId: string,             // 20 bytes
  appliedAt: Timestamp,       // 12 bytes
  appliedBy: string,          // 20 bytes
  changes: [
    {
      field: string,          // ~20 bytes
      oldValue: any,          // ~30 bytes
      newValue: any,          // ~30 bytes
    }
  ],                          // ~100 bytes per change
}
// TOTAL: ~150-250 bytes per history entry
```

**Benefits of Subcollection:**
- ✅ Main transaction stays small
- ✅ Unlimited history (subcollections can have millions of docs)
- ✅ History only loaded when needed
- ✅ Can archive/delete old history independently

### Storage Optimization Recommendations

1. **Archive Old History:**
   ```typescript
   // Delete rule history older than 1 year
   const cutoff = new Date();
   cutoff.setFullYear(cutoff.getFullYear() - 1);

   await db.collectionGroup('rule_history')
     .where('appliedAt', '<', Timestamp.fromDate(cutoff))
     .get()
     .then(snapshot => {
       const batch = db.batch();
       snapshot.docs.forEach(doc => batch.delete(doc.ref));
       return batch.commit();
     });
   ```

2. **Lightweight History in Metadata:**
   ```typescript
   // Keep only last 5 rule applications in metadata
   metadata.ruleHistory = metadata.ruleHistory?.slice(-5);
   ```

3. **Compress Old Transactions:**
   ```typescript
   // Remove plaidData from transactions older than 2 years
   // (if rules are stable and no revert needed)
   ```

### Monitoring

**Set up alerts for document size:**
```typescript
function checkTransactionSize(transaction: Transaction) {
  const size = JSON.stringify(transaction).length;
  const warningThreshold = 500000;  // 500 KB

  if (size > warningThreshold) {
    console.warn(`Transaction ${transaction.id} is ${size} bytes (${Math.round(size/1024)} KB)`);
    // Trigger alert/notification
  }
}
```

## Migration Strategy

### Phase 1: Add plaidData Field

**Objective:** Add `plaidData` to existing transactions without breaking anything

**Approach:**
```typescript
/**
 * Migration: Add plaidData to existing transactions
 */
async function migrateTransactionsToRulesSupport(userId: string) {
  const BATCH_SIZE = 500;
  let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  let totalMigrated = 0;

  do {
    let query = db.collection('transactions')
      .where('userId', '==', userId)
      .limit(BATCH_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    const batch = db.batch();

    for (const doc of snapshot.docs) {
      const transaction = doc.data() as Transaction;

      // Skip if already migrated
      if (transaction.plaidData) continue;

      // Create plaidData from existing fields
      const plaidData = {
        category: transaction.metadata.plaidCategory?.join(',') || '',
        detailedCategory: transaction.category,
        merchantName: transaction.metadata.plaidMerchantName || transaction.description,
        amount: transaction.amount,
        date: transaction.date,
        description: transaction.description,
        pending: transaction.metadata.plaidPending || false,
        personalFinanceCategory: transaction.metadata.plaidPersonalFinanceCategory
      };

      batch.update(doc.ref, {
        plaidData,
        appliedRules: [],
        isRuleModified: false,
        ruleApplicationCount: 0,
        'metadata.categorySource': 'plaid',
        'metadata.originalPlaidCategory': transaction.category
      });

      totalMigrated++;
    }

    await batch.commit();
    lastDoc = snapshot.docs[snapshot.docs.length - 1];

    console.log(`Migrated ${totalMigrated} transactions...`);

  } while (lastDoc);

  console.log(`Migration complete: ${totalMigrated} transactions`);
}
```

### Phase 2: Gradual Rollout

**Week 1:** Deploy rules infrastructure (no user-facing features)
- Deploy rule types and utilities
- Add plaidData to new Plaid transactions
- Run migration script for existing transactions
- Monitor document sizes

**Week 2:** Beta testing with admin accounts
- Enable rule creation for admins only
- Test rule evaluation and application
- Gather feedback on performance
- Fix any issues

**Week 3:** Limited user rollout
- Enable for 10% of users
- Monitor performance metrics
- Track rule creation and application
- Collect user feedback

**Week 4:** Full rollout
- Enable for all users
- Add UI components for rule management
- Provide user documentation
- Monitor and optimize

### Phase 3: Data Validation

**Validation Checks:**
```typescript
async function validateRulesMigration() {
  // 1. Check all transactions have plaidData
  const withoutPlaidData = await db.collection('transactions')
    .where('plaidData', '==', null)
    .count()
    .get();

  console.log(`Transactions without plaidData: ${withoutPlaidData.data().count}`);

  // 2. Check document sizes
  const largeTransactions = await db.collection('transactions')
    .get()
    .then(snapshot => {
      return snapshot.docs.filter(doc => {
        const size = JSON.stringify(doc.data()).length;
        return size > 500000;  // > 500 KB
      });
    });

  console.log(`Large transactions (>500KB): ${largeTransactions.length}`);

  // 3. Verify category sources
  const sourceCounts = {
    plaid: 0,
    rule: 0,
    manual: 0,
    unknown: 0
  };

  const snapshot = await db.collection('transactions').get();
  snapshot.docs.forEach(doc => {
    const source = doc.data().metadata?.categorySource || 'unknown';
    sourceCounts[source]++;
  });

  console.log('Category sources:', sourceCounts);
}
```

### Rollback Plan

**If issues arise:**

1. **Disable rule application:**
   ```typescript
   // Feature flag
   const RULES_ENABLED = false;

   if (RULES_ENABLED) {
     await applyRulesToTransaction(transaction, rules);
   }
   ```

2. **Remove plaidData (if needed):**
   ```typescript
   async function rollbackPlaidData() {
     const batch = db.batch();
     const snapshot = await db.collection('transactions').get();

     snapshot.docs.forEach(doc => {
       batch.update(doc.ref, {
         plaidData: admin.firestore.FieldValue.delete(),
         appliedRules: admin.firestore.FieldValue.delete(),
         isRuleModified: admin.firestore.FieldValue.delete()
       });
     });

     await batch.commit();
   }
   ```

3. **Revert transactions to original state:**
   ```typescript
   async function revertAllRuleModifications() {
     const snapshot = await db.collection('transactions')
       .where('isRuleModified', '==', true)
       .get();

     const batch = db.batch();
     snapshot.docs.forEach(doc => {
       const txn = doc.data() as Transaction;

       // Restore from plaidData
       batch.update(doc.ref, {
         category: txn.plaidData.detailedCategory,
         merchantName: txn.plaidData.merchantName,
         appliedRules: [],
         isRuleModified: false,
         'metadata.categorySource': 'plaid'
       });
     });

     await batch.commit();
   }
   ```

## User Workflows

### Creating a Simple Rule

**Scenario:** User wants all Walmart purchases categorized as Groceries

**Steps:**
1. User opens "Rules" section
2. Clicks "Create New Rule"
3. Names rule: "Walmart → Groceries"
4. Adds condition:
   - Field: Merchant Name
   - Operator: Contains
   - Value: "walmart"
5. Adds action:
   - Set category: "FOOD_AND_DRINK_GROCERIES"
6. Clicks "Preview Impact"
   - System shows: "47 transactions would be affected"
   - Shows sample transactions
7. User clicks "Create & Apply"
8. System applies rule to all past transactions
9. Confirmation: "Rule created and applied to 47 transactions"

### Creating Complex AND/OR Rule

**Scenario:** User wants gas stations categorized as Transportation, but only purchases over $20

**Steps:**
1. User creates new rule: "Gas Stations → Transportation"
2. Adds condition group 1 (OR):
   - Merchant contains "smiths gas"
   - Merchant contains "chevron"
   - Merchant contains "shell"
3. Adds condition group 2 (AND):
   - Amount greater than $20
4. Sets action: Category = "TRANSPORTATION_GAS"
5. Previews and creates

### Reverting a Rule

**Scenario:** User accidentally created wrong rule and wants to undo

**Steps:**
1. User opens "Rules" section
2. Finds problematic rule
3. Clicks "Revert Rule"
4. System shows: "This will revert 23 transactions. Continue?"
5. User confirms
6. System:
   - Disables rule
   - Recalculates 23 transactions using remaining rules
   - Restores original categories where no other rules apply
7. Confirmation: "Rule reverted. 23 transactions updated."

### Managing Rule Conflicts

**Scenario:** Two rules conflict (both trying to set category)

**Steps:**
1. User creates second rule that conflicts
2. System detects conflict:
   - "This rule conflicts with 'Gas Stations → Transportation'"
   - "Both rules will set category for the same transactions"
3. System shows resolution options:
   - Keep higher priority rule only
   - Apply both (last wins)
   - Adjust priority to resolve
4. User adjusts priority:
   - Rule A: Priority 100
   - Rule B: Priority 90
5. System applies Rule A (higher priority) when both match

## Testing Guidelines

### Unit Testing Rule Conditions

```typescript
describe('String Condition Matching', () => {
  it('should match contains (case insensitive)', () => {
    const condition: StringCondition = {
      type: 'string',
      contains: 'smiths',
      caseSensitive: false
    };

    expect(matchStringCondition('Smiths Gas', condition)).toBe(true);
    expect(matchStringCondition('SMITHS GAS STATION', condition)).toBe(true);
    expect(matchStringCondition('Chevron', condition)).toBe(false);
  });

  it('should match equals (case sensitive)', () => {
    const condition: StringCondition = {
      type: 'string',
      equals: 'Smiths Gas',
      caseSensitive: true
    };

    expect(matchStringCondition('Smiths Gas', condition)).toBe(true);
    expect(matchStringCondition('smiths gas', condition)).toBe(false);
  });
});
```

### Integration Testing Rule Application

```typescript
describe('Rule Application', () => {
  it('should apply rule to matching transaction', async () => {
    const rule: CategoryRule = {
      name: 'Test Rule',
      conditions: {
        operator: 'AND',
        conditionGroups: [{
          operator: 'AND',
          conditions: [{
            field: 'merchantName',
            condition: {
              type: 'string',
              contains: 'test',
              caseSensitive: false
            }
          }]
        }]
      },
      actions: {
        setCategory: 'TEST_CATEGORY'
      },
      priority: 100,
      isActive: true
    };

    const transaction: Transaction = {
      merchantName: 'Test Merchant',
      category: 'OTHER',
      plaidData: { /* ... */ }
    };

    const result = await applyRulesToTransaction(transaction, [rule]);

    expect(result.category).toBe('TEST_CATEGORY');
    expect(result.appliedRules).toContain(rule.id);
    expect(result.isRuleModified).toBe(true);
  });
});
```

### Performance Testing

```typescript
describe('Rule Performance', () => {
  it('should evaluate 1000 rules in under 100ms', async () => {
    const rules = generateTestRules(1000);
    const transaction = generateTestTransaction();

    const start = Date.now();
    await applyRulesToTransaction(transaction, rules);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100);
  });

  it('should use short-circuit evaluation', async () => {
    let evaluationCount = 0;

    const condition = () => {
      evaluationCount++;
      return false;
    };

    // AND with first false should stop immediately
    const result = [condition(), condition(), condition()].every(r => r);

    expect(result).toBe(false);
    expect(evaluationCount).toBe(1);  // Only evaluated first
  });
});
```

## Future Enhancements

### Split Modification Rules

**Concept:** Rules that modify transaction splits

**Example:**
```typescript
{
  name: "Split Costco Purchases",
  conditions: {
    merchantName: { contains: "costco" }
  },
  actions: {
    splitTransaction: {
      percentage: 70,
      categories: [
        { category: "GROCERIES", percentage: 70 },
        { category: "HOUSEHOLD", percentage: 30 }
      ]
    }
  }
}
```

### Budget Assignment Rules

**Concept:** Automatically assign transactions to specific budgets

**Example:**
```typescript
{
  name: "Dining Out → Entertainment Budget",
  conditions: {
    category: { equals: "FOOD_AND_DRINK_RESTAURANTS" }
  },
  actions: {
    setBudget: "entertainment_budget_id"
  }
}
```

### Family-Shared Rules

**Concept:** Rules shared across family members

**Example:**
```typescript
{
  familyId: "family_123",
  isShared: true,
  createdBy: "admin_user_id",
  name: "Family Gas Stations",
  // ... conditions and actions
}
```

### Rule Templates/Presets

**Concept:** Pre-built rules users can enable

**Examples:**
- "Gas Stations → Transportation"
- "Grocery Stores → Food"
- "Streaming Services → Entertainment"
- "Medical → Healthcare"

### Machine Learning Suggestions

**Concept:** Suggest rules based on user behavior

**Example:**
```typescript
interface RuleSuggestion {
  suggestedRule: CategoryRule;
  confidence: number;
  basedOn: {
    patternCount: number;
    manualCategorizationCount: number;
    similarUsers: number;
  };
}
```

### Rule Analytics

**Concept:** Insights on rule effectiveness

**Metrics:**
- Transactions affected per rule
- Category distribution changes
- Rule conflict frequency
- User engagement with rules

## Troubleshooting

### Common Issues

**Issue 1: Rule not matching expected transactions**

**Diagnosis:**
```typescript
// Use test function to see why rule doesn't match
const testResult = await testRule(ruleId, [transactionId]);

console.log('Match result:', testResult.results[0].matched);
console.log('Evaluated conditions:', testResult.results[0].evaluationDetails);
```

**Solutions:**
- Check condition syntax (case sensitivity, contains vs equals)
- Verify field values (merchantName might be different than expected)
- Test with sample data
- Check boolean operator (AND vs OR)

**Issue 2: Rules conflicting with each other**

**Diagnosis:**
```typescript
// Check for conflicts
const conflicts = await detectRuleConflicts(userId);

console.log('Conflicting rules:', conflicts);
```

**Solutions:**
- Adjust rule priorities
- Combine rules with OR logic
- Disable one of the conflicting rules
- Add exclusion conditions

**Issue 3: Performance slow with many rules**

**Diagnosis:**
```typescript
// Profile rule evaluation
const start = Date.now();
await applyRulesToTransaction(transaction, rules);
const duration = Date.now() - start;

console.log(`Evaluation took ${duration}ms for ${rules.length} rules`);
```

**Solutions:**
- Reduce rule count (combine similar rules)
- Increase rule priorities for commonly matched rules
- Use more specific conditions (earlier short-circuit)
- Enable caching

**Issue 4: Transactions not updating after rule creation**

**Diagnosis:**
```typescript
// Check trigger execution
const logs = await admin.logging().get({
  filter: 'resource.type="cloud_function" AND resource.labels.function_name="onRuleCreated"'
});

console.log('Trigger logs:', logs);
```

**Solutions:**
- Verify rule is marked as `isActive: true`
- Check for trigger errors in logs
- Manually apply rule: `applyRule({ ruleId })`
- Verify user permissions

### Debug Commands

```bash
# Check rule structure
firebase firestore:get rules/{ruleId}

# View affected transactions
firebase firestore:get transactions --where "appliedRules array-contains {ruleId}"

# Check trigger logs
firebase functions:log --only onRuleCreated

# Test rule locally
firebase emulators:start --only functions,firestore
```

### Monitoring

**Set up Cloud Monitoring alerts:**

1. **Rule evaluation duration:**
   ```typescript
   if (evaluationDuration > 5000) {
     console.warn(`Rule evaluation slow: ${evaluationDuration}ms`);
   }
   ```

2. **Rule match count:**
   ```typescript
   if (rule.matchCount > 10000) {
     console.warn(`Rule ${rule.id} matches too many transactions`);
   }
   ```

3. **Error rate:**
   ```typescript
   // Track errors in rule application
   const errorRate = errors / totalApplications;
   if (errorRate > 0.01) {  // > 1%
     console.error(`High error rate in rule ${rule.id}: ${errorRate * 100}%`);
   }
   ```

## Development Guidelines

### Adding New Condition Types

**Steps:**
1. Add type to `RuleCondition` union in `ruleTypes.ts`
2. Implement matcher in `ruleMatching.ts`
3. Add validation in `ruleValidation.ts`
4. Update UI components for condition builder
5. Add tests for new condition type
6. Document in this file

**Example: Adding "Location" condition:**
```typescript
// 1. Add type
interface LocationCondition {
  type: 'location';
  within?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  city?: string;
  state?: string;
}

// 2. Implement matcher
function matchLocationCondition(
  value: TransactionLocation,
  condition: LocationCondition
): boolean {
  if (condition.within) {
    const distance = calculateDistance(
      value.latitude,
      value.longitude,
      condition.within.latitude,
      condition.within.longitude
    );
    return distance <= condition.within.radiusMeters;
  }

  if (condition.city) {
    return value.city?.toLowerCase() === condition.city.toLowerCase();
  }

  return false;
}
```

### Adding New Action Types

**Steps:**
1. Add to `RuleActions` interface in `ruleTypes.ts`
2. Implement applier in `ruleApplication.ts`
3. Add validation
4. Update UI
5. Test
6. Document

**Example: Adding "Set Flag" action:**
```typescript
// 1. Add to interface
interface RuleActions {
  // ... existing actions
  setFlag?: {
    flag: 'important' | 'review' | 'ignore';
    value: boolean;
  };
}

// 2. Implement applier
async function applySetFlagAction(
  transaction: Transaction,
  action: { flag: string; value: boolean }
): Promise<Transaction> {
  return {
    ...transaction,
    flags: {
      ...transaction.flags,
      [action.flag]: action.value
    }
  };
}
```

### Best Practices

**DO:**
- ✅ Write comprehensive tests for all condition types
- ✅ Use short-circuit evaluation for performance
- ✅ Cache expensive operations
- ✅ Validate rule syntax before saving
- ✅ Provide clear error messages
- ✅ Log rule applications for debugging
- ✅ Use priority to resolve conflicts
- ✅ Allow users to preview before applying

**DON'T:**
- ❌ Modify original Plaid data
- ❌ Allow unlimited nesting depth
- ❌ Skip validation on user input
- ❌ Forget to update rule statistics
- ❌ Apply rules without user confirmation
- ❌ Hard delete rules (soft delete for history)
- ❌ Ignore performance implications
- ❌ Forget to handle edge cases

## Notes for AI Assistants

- **This is a rules-based recalculation system** - not transaction duplication
- **Original Plaid data is immutable** - stored in `plaidData` field
- **Current state is computed** - by applying rules to plaidData
- **Revert is simple** - disable rule and recalculate
- **Rules apply retroactively** - to past and future transactions
- **Boolean logic is fully supported** - nested AND/OR conditions
- **Document size is not a concern** - transactions stay ~2.5 KB
- **History in subcollections** - keeps main docs small
- **Priority resolves conflicts** - higher priority wins
- **Short-circuit for performance** - stop evaluating when result is known
- **Cache aggressively** - rule evaluations, user rules, condition matches
- **Test before deploying** - use preview and test functions
- **Monitor performance** - track evaluation times and error rates
- **Follow migration plan** - gradual rollout with rollback option
- **This is DOCUMENTATION ONLY** - actual implementation is in placeholder files
- **Use types from ruleTypes.ts** - comprehensive type definitions provided
- **Security via Firestore rules** - users own their rules
- **No implementation yet** - this is planning/architecture phase
