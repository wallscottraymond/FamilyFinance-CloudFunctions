/**
 * Rule Types - Type Definitions for Rules System
 *
 * This module contains all TypeScript type definitions for the rules-based
 * transaction categorization system.
 *
 * Key Concepts:
 * - Rules transform transactions using boolean logic (AND/OR operators)
 * - Original Plaid data stored immutably in transaction.plaidData
 * - Current state computed by applying active rules
 * - Rules can be reverted by disabling and recalculating
 *
 * See: src/functions/rules/CLAUDE.md for comprehensive documentation
 */

import { Timestamp } from 'firebase-admin/firestore';
import { BaseDocument } from '../../../types';

// ============================================================================
// MAIN RULE INTERFACE
// ============================================================================

/**
 * CategoryRule - User-defined rule for transaction categorization
 *
 * Rules use boolean logic to match transactions and apply actions.
 *
 * Example:
 * {
 *   name: "Gas Stations → Transportation",
 *   conditions: {
 *     operator: 'OR',
 *     conditionGroups: [
 *       { merchant contains "smiths gas" },
 *       { merchant contains "chevron" }
 *     ]
 *   },
 *   actions: {
 *     setCategory: "TRANSPORTATION_GAS"
 *   }
 * }
 */
export interface CategoryRule extends BaseDocument {
  // Ownership
  userId: string;                  // Rule owner (required)
  familyId?: string;               // Future: family-shared rules

  // Rule identification
  name: string;                    // Display name (e.g., "Gas Stations → Transportation")
  description?: string;            // Optional description for user reference

  // Boolean logic conditions
  conditions: RuleConditions;      // When to apply this rule

  // Actions to apply when conditions match
  actions: RuleActions;            // What to do when rule matches

  // Rule metadata
  isActive: boolean;               // Is rule currently active?
  priority: number;                // Evaluation priority (higher = evaluated first)
  matchCount: number;              // Number of transactions that matched
  lastAppliedAt?: Timestamp;       // Last time rule was applied

  // Conflict detection
  conflictsWith?: string[];        // IDs of other rules that conflict

  // Testing and preview
  isTestMode?: boolean;            // For testing before activation
  lastTestedAt?: Timestamp;        // Last test timestamp
  testResults?: RuleTestResults;   // Results from last test

  // Timestamps (from BaseDocument)
  // createdAt: Timestamp;
  // updatedAt: Timestamp;
}

// ============================================================================
// BOOLEAN LOGIC STRUCTURES
// ============================================================================

/**
 * RuleConditions - Top-level boolean logic structure
 *
 * Supports complex nested AND/OR logic for matching transactions.
 *
 * Example (Simple OR):
 * {
 *   operator: 'OR',
 *   conditionGroups: [
 *     { conditions: [{ merchantName contains "smiths" }] },
 *     { conditions: [{ merchantName contains "walmart" }] }
 *   ]
 * }
 *
 * Example (Complex):
 * {
 *   operator: 'AND',
 *   conditionGroups: [
 *     {  // Group 1: Gas stations (OR)
 *       operator: 'OR',
 *       conditions: [merchantA, merchantB, merchantC]
 *     },
 *     {  // Group 2: Amount threshold (AND)
 *       operator: 'AND',
 *       conditions: [amount > 50]
 *     }
 *   ]
 * }
 */
export interface RuleConditions {
  operator: 'AND' | 'OR';          // How to combine condition groups
  conditionGroups: ConditionGroup[]; // Array of condition groups
}

/**
 * ConditionGroup - Group of conditions with boolean operator
 *
 * Allows nesting for complex logic like: (A AND B) OR (C AND D)
 */
export interface ConditionGroup {
  operator: 'AND' | 'OR';          // How to combine conditions in this group
  conditions: RuleCondition[];     // Array of individual conditions
  nested?: ConditionGroup[];       // Optional nested groups for deeper logic
}

/**
 * RuleCondition - Individual condition to evaluate
 *
 * Specifies which field to check and how to check it.
 */
export interface RuleCondition {
  field: RuleConditionField;       // Which transaction field to evaluate
  condition: StringCondition | NumberRange | DateRange | CategoryCondition | ArrayCondition;
}

/**
 * RuleConditionField - Fields that can be used in conditions
 *
 * These correspond to transaction fields that rules can evaluate.
 */
export type RuleConditionField =
  | 'merchantName'             // plaidData.merchantName or current merchantName
  | 'description'              // plaidData.description or current description
  | 'amount'                   // Transaction amount
  | 'date'                     // Transaction date
  | 'plaidCategory'            // plaidData.category (joined array)
  | 'plaidDetailedCategory'    // plaidData.detailedCategory
  | 'plaidPrimaryCategory'     // plaidData.primaryCategory
  | 'dayOfWeek'                // Day of week (0-6, Sunday=0)
  | 'tags';                    // Transaction tags array

// ============================================================================
// CONDITION TYPES
// ============================================================================

/**
 * StringCondition - String matching conditions
 *
 * Supports various string matching strategies.
 *
 * Examples:
 * { equals: "Walmart", caseSensitive: false }
 * { contains: "gas", caseSensitive: false }
 * { startsWith: "Smith", caseSensitive: true }
 * { regex: "^(Smiths|Smith's) Gas$", caseSensitive: false }
 */
export interface StringCondition {
  type: 'string';
  equals?: string;                 // Exact match
  contains?: string;               // Substring match
  startsWith?: string;             // Prefix match
  endsWith?: string;               // Suffix match
  regex?: string;                  // Regular expression (advanced)
  caseSensitive: boolean;          // Case-sensitive matching
}

/**
 * NumberRange - Numeric comparison conditions
 *
 * Supports various numeric comparisons.
 *
 * Examples:
 * { min: 50 }                  // >= 50
 * { max: 100 }                 // <= 100
 * { min: 50, max: 100 }        // Between 50 and 100
 * { equals: 45.99 }            // Exact amount
 */
export interface NumberRange {
  type: 'number';
  equals?: number;                 // Exact value
  min?: number;                    // Minimum value (inclusive)
  max?: number;                    // Maximum value (inclusive)
  notEquals?: number;              // Exclusion
}

/**
 * DateRange - Date comparison conditions
 *
 * Supports absolute and relative date matching.
 *
 * Examples:
 * { before: Timestamp }        // Before specific date
 * { after: Timestamp }         // After specific date
 * { between: { start, end } }  // Date range
 * { relative: { unit: 'days', value: 30, direction: 'past' } } // Last 30 days
 */
export interface DateRange {
  type: 'date';
  before?: Timestamp;              // Before specific date
  after?: Timestamp;               // After specific date
  between?: {                      // Date range
    start: Timestamp;
    end: Timestamp;
  };
  relative?: RelativeDateCondition; // Relative to current date
}

/**
 * RelativeDateCondition - Relative date specification
 *
 * Examples:
 * { unit: 'days', value: 30, direction: 'past' }     // Last 30 days
 * { unit: 'months', value: 3, direction: 'past' }    // Last 3 months
 * { unit: 'weeks', value: 2, direction: 'future' }   // Next 2 weeks
 */
export interface RelativeDateCondition {
  unit: 'days' | 'weeks' | 'months' | 'years';
  value: number;                   // How many units
  direction: 'past' | 'future';    // Direction from now
}

/**
 * CategoryCondition - Category matching conditions
 *
 * Supports Plaid category hierarchy matching.
 *
 * Examples:
 * { exactMatch: "FOOD_AND_DRINK_GROCERIES" }
 * { primaryMatch: "FOOD_AND_DRINK" }
 * { includes: ["GROCERIES", "RESTAURANTS"] }
 * { excludes: ["FAST_FOOD"] }
 */
export interface CategoryCondition {
  type: 'category';
  exactMatch?: string;             // Exact category match
  primaryMatch?: string;           // Match primary category
  includes?: string[];             // Must include one of these
  excludes?: string[];             // Must not include any of these
}

/**
 * ArrayCondition - Array matching conditions
 *
 * Used for fields like tags, categories, etc.
 *
 * Examples:
 * { includes: ["tag1", "tag2"] }      // Must include all (AND)
 * { includesAny: ["tag1", "tag2"] }   // Must include at least one (OR)
 * { excludes: ["tag3"] }              // Must not include
 */
export interface ArrayCondition {
  type: 'array';
  includes?: string[];             // Must include all (AND)
  excludes?: string[];             // Must exclude all
  includesAny?: string[];          // Must include at least one (OR)
  includesAll?: string[];          // Must include all (AND) - alias for includes
}

// ============================================================================
// RULE ACTIONS
// ============================================================================

/**
 * RuleActions - Actions to apply when rule matches
 *
 * Multiple actions can be specified and will be applied in order.
 *
 * Example:
 * {
 *   setCategory: "TRANSPORTATION_GAS",
 *   addTags: ["gas", "auto"],
 *   setNote: "Categorized by rule"
 * }
 */
export interface RuleActions {
  setCategory?: string;            // Set transaction category
  addTags?: string[];              // Add tags to transaction
  removeTags?: string[];           // Remove tags from transaction
  setNote?: string;                // Set transaction note
  appendNote?: string;             // Append to existing note
  setBudget?: string;              // Assign to budget (future)
  // Future actions:
  // modifySplits?: SplitModification[];
  // setFlags?: { [key: string]: boolean };
  // assignToUser?: string;
}

// ============================================================================
// RULE TESTING & PREVIEW
// ============================================================================

/**
 * RuleTestResults - Results from testing a rule
 *
 * Used for preview and validation before applying.
 */
export interface RuleTestResults {
  totalTransactionsChecked: number; // Total transactions evaluated
  matchingTransactions: number;     // Number that matched
  sampleMatches: string[];          // Sample transaction IDs that matched
  nonMatches: string[];             // Sample transaction IDs that didn't match
  evaluationTimeMs: number;         // Time taken to evaluate
}

/**
 * RulePreviewResult - Detailed preview of rule impact
 *
 * Shows what would change if rule is applied.
 */
export interface RulePreviewResult {
  transactionId: string;
  description: string;
  currentCategory: string;
  newCategory?: string;
  currentTags: string[];
  newTags?: string[];
  changes: string[];               // Human-readable list of changes
}

// ============================================================================
// RULE APPLICATION HISTORY
// ============================================================================

/**
 * RuleApplicationHistory - History of rule applications
 *
 * Stored in subcollection: transactions/{transactionId}/rule_history/{historyId}
 *
 * Provides audit trail of all rule applications.
 */
export interface RuleApplicationHistory extends BaseDocument {
  ruleId: string;                  // Which rule was applied
  transactionId: string;           // Which transaction
  appliedAt: Timestamp;            // When
  appliedBy: string;               // User ID or "system"
  changes: RuleChange[];           // What changed
  wasAutomatic: boolean;           // Auto vs manual application
}

/**
 * RuleChange - Individual change made by rule
 *
 * Records what field was changed and how.
 */
export interface RuleChange {
  field: string;                   // Field that changed (e.g., "category")
  oldValue: any;                   // Previous value
  newValue: any;                   // New value
  action: string;                  // Action type (e.g., "setCategory")
}

// ============================================================================
// RULE EVALUATION CACHE
// ============================================================================

/**
 * RuleEvaluationCache - Cache for rule evaluation results
 *
 * Improves performance by caching expensive evaluations.
 *
 * Stored in memory or Redis for fast lookups.
 */
export interface RuleEvaluationCache {
  transactionId: string;           // Transaction ID
  ruleId: string;                  // Rule ID
  result: boolean;                 // Did rule match?
  evaluatedAt: Timestamp;          // When evaluated
  ttl: number;                     // Time-to-live in milliseconds
}

// ============================================================================
// API REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * CreateRuleRequest - Request to create new rule
 */
export interface CreateRuleRequest {
  name: string;
  description?: string;
  conditions: RuleConditions;
  actions: RuleActions;
  priority?: number;               // Default: 100
  applyRetroactively?: boolean;    // Default: true
  testFirst?: boolean;             // Preview before creating
}

/**
 * CreateRuleResponse - Response from creating rule
 */
export interface CreateRuleResponse {
  success: boolean;
  ruleId?: string;
  previewResults?: {
    matchingTransactions: number;
    sampleTransactions: string[];
  };
  message?: string;
}

/**
 * UpdateRuleRequest - Request to update existing rule
 */
export interface UpdateRuleRequest {
  ruleId: string;
  updates: {
    name?: string;
    description?: string;
    conditions?: RuleConditions;
    actions?: RuleActions;
    priority?: number;
    isActive?: boolean;
  };
  reapplyToTransactions?: boolean; // Re-apply to affected transactions
}

/**
 * DeleteRuleRequest - Request to delete rule
 */
export interface DeleteRuleRequest {
  ruleId: string;
  revertTransactions?: boolean;    // Recalculate affected transactions
  hardDelete?: boolean;            // Permanently delete vs soft delete
}

/**
 * ListRulesRequest - Request to list user's rules
 */
export interface ListRulesRequest {
  isActive?: boolean;              // Filter by active status
  sortBy?: 'priority' | 'createdAt' | 'matchCount' | 'name';
  sortDirection?: 'asc' | 'desc';
  limit?: number;
}

/**
 * ListRulesResponse - Response with user's rules
 */
export interface ListRulesResponse {
  success: boolean;
  rules: CategoryRule[];
  totalCount: number;
}

/**
 * PreviewRuleRequest - Request to preview rule impact
 */
export interface PreviewRuleRequest {
  conditions: RuleConditions;
  actions: RuleActions;
  sampleSize?: number;             // Max: 100
}

/**
 * PreviewRuleResponse - Response with preview results
 */
export interface PreviewRuleResponse {
  success: boolean;
  matchingCount: number;
  totalTransactions: number;
  sampleMatches: RulePreviewResult[];
  estimatedImpact: string;         // Human-readable impact summary
}

/**
 * TestRuleRequest - Request to test rule against specific transactions
 */
export interface TestRuleRequest {
  ruleId: string;
  transactionIds: string[];
}

/**
 * TestRuleResponse - Response with test results
 */
export interface TestRuleResponse {
  success: boolean;
  results: Array<{
    transactionId: string;
    matched: boolean;
    appliedChanges?: RuleChange[];
    evaluationDetails?: any;       // Detailed evaluation breakdown
  }>;
}

/**
 * ApplyRuleRequest - Request to apply rule to transactions
 */
export interface ApplyRuleRequest {
  ruleId: string;
  transactionIds?: string[];       // Specific transactions, or all if not provided
  forceReapply?: boolean;          // Apply even if already applied
}

/**
 * ApplyRuleResponse - Response from applying rule
 */
export interface ApplyRuleResponse {
  success: boolean;
  transactionsAffected: number;
  transactionsProcessed: number;
  errors?: string[];
  message?: string;
}

/**
 * RevertRuleRequest - Request to revert rule
 */
export interface RevertRuleRequest {
  ruleId: string;
  deleteRule?: boolean;            // Delete after reverting
}

/**
 * RevertRuleResponse - Response from reverting rule
 */
export interface RevertRuleResponse {
  success: boolean;
  transactionsReverted: number;
  message?: string;
}

// ============================================================================
// VALIDATION & ERROR TYPES
// ============================================================================

/**
 * RuleValidationResult - Result of rule validation
 */
export interface RuleValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * RuleConflict - Detected conflict between rules
 */
export interface RuleConflict {
  ruleId1: string;
  ruleId2: string;
  conflictType: 'category' | 'tag' | 'budget' | 'priority';
  description: string;
  resolution?: string;             // Suggested resolution
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/**
 * RuleEvaluationContext - Context for rule evaluation
 *
 * Contains all data needed to evaluate a rule against a transaction.
 */
export interface RuleEvaluationContext {
  transaction: any;                // Transaction being evaluated (Transaction type)
  currentDate: Date;               // Current date for relative date conditions
  userRules: CategoryRule[];       // All user's rules for conflict detection
  cache?: Map<string, boolean>;    // Optional evaluation cache
}

/**
 * RuleStatistics - Statistics about rule usage
 */
export interface RuleStatistics {
  ruleId: string;
  matchCount: number;
  applicationCount: number;
  lastAppliedAt?: Timestamp;
  averageEvaluationTimeMs: number;
  errorRate: number;
}

// ============================================================================
// EXPORTS
// ============================================================================

// All types are already exported via their interface/type declarations above
// No need for re-export as they're already exported
