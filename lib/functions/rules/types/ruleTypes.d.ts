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
    userId: string;
    familyId?: string;
    name: string;
    description?: string;
    conditions: RuleConditions;
    actions: RuleActions;
    isActive: boolean;
    priority: number;
    matchCount: number;
    lastAppliedAt?: Timestamp;
    conflictsWith?: string[];
    isTestMode?: boolean;
    lastTestedAt?: Timestamp;
    testResults?: RuleTestResults;
}
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
    operator: 'AND' | 'OR';
    conditionGroups: ConditionGroup[];
}
/**
 * ConditionGroup - Group of conditions with boolean operator
 *
 * Allows nesting for complex logic like: (A AND B) OR (C AND D)
 */
export interface ConditionGroup {
    operator: 'AND' | 'OR';
    conditions: RuleCondition[];
    nested?: ConditionGroup[];
}
/**
 * RuleCondition - Individual condition to evaluate
 *
 * Specifies which field to check and how to check it.
 */
export interface RuleCondition {
    field: RuleConditionField;
    condition: StringCondition | NumberRange | DateRange | CategoryCondition | ArrayCondition;
}
/**
 * RuleConditionField - Fields that can be used in conditions
 *
 * These correspond to transaction fields that rules can evaluate.
 */
export type RuleConditionField = 'merchantName' | 'description' | 'amount' | 'date' | 'plaidCategory' | 'plaidDetailedCategory' | 'plaidPrimaryCategory' | 'dayOfWeek' | 'tags';
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
    equals?: string;
    contains?: string;
    startsWith?: string;
    endsWith?: string;
    regex?: string;
    caseSensitive: boolean;
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
    equals?: number;
    min?: number;
    max?: number;
    notEquals?: number;
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
    before?: Timestamp;
    after?: Timestamp;
    between?: {
        start: Timestamp;
        end: Timestamp;
    };
    relative?: RelativeDateCondition;
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
    value: number;
    direction: 'past' | 'future';
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
    exactMatch?: string;
    primaryMatch?: string;
    includes?: string[];
    excludes?: string[];
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
    includes?: string[];
    excludes?: string[];
    includesAny?: string[];
    includesAll?: string[];
}
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
    setCategory?: string;
    addTags?: string[];
    removeTags?: string[];
    setNote?: string;
    appendNote?: string;
    setBudget?: string;
}
/**
 * RuleTestResults - Results from testing a rule
 *
 * Used for preview and validation before applying.
 */
export interface RuleTestResults {
    totalTransactionsChecked: number;
    matchingTransactions: number;
    sampleMatches: string[];
    nonMatches: string[];
    evaluationTimeMs: number;
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
    changes: string[];
}
/**
 * RuleApplicationHistory - History of rule applications
 *
 * Stored in subcollection: transactions/{transactionId}/rule_history/{historyId}
 *
 * Provides audit trail of all rule applications.
 */
export interface RuleApplicationHistory extends BaseDocument {
    ruleId: string;
    transactionId: string;
    appliedAt: Timestamp;
    appliedBy: string;
    changes: RuleChange[];
    wasAutomatic: boolean;
}
/**
 * RuleChange - Individual change made by rule
 *
 * Records what field was changed and how.
 */
export interface RuleChange {
    field: string;
    oldValue: any;
    newValue: any;
    action: string;
}
/**
 * RuleEvaluationCache - Cache for rule evaluation results
 *
 * Improves performance by caching expensive evaluations.
 *
 * Stored in memory or Redis for fast lookups.
 */
export interface RuleEvaluationCache {
    transactionId: string;
    ruleId: string;
    result: boolean;
    evaluatedAt: Timestamp;
    ttl: number;
}
/**
 * CreateRuleRequest - Request to create new rule
 */
export interface CreateRuleRequest {
    name: string;
    description?: string;
    conditions: RuleConditions;
    actions: RuleActions;
    priority?: number;
    applyRetroactively?: boolean;
    testFirst?: boolean;
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
    reapplyToTransactions?: boolean;
}
/**
 * DeleteRuleRequest - Request to delete rule
 */
export interface DeleteRuleRequest {
    ruleId: string;
    revertTransactions?: boolean;
    hardDelete?: boolean;
}
/**
 * ListRulesRequest - Request to list user's rules
 */
export interface ListRulesRequest {
    isActive?: boolean;
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
    sampleSize?: number;
}
/**
 * PreviewRuleResponse - Response with preview results
 */
export interface PreviewRuleResponse {
    success: boolean;
    matchingCount: number;
    totalTransactions: number;
    sampleMatches: RulePreviewResult[];
    estimatedImpact: string;
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
        evaluationDetails?: any;
    }>;
}
/**
 * ApplyRuleRequest - Request to apply rule to transactions
 */
export interface ApplyRuleRequest {
    ruleId: string;
    transactionIds?: string[];
    forceReapply?: boolean;
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
    deleteRule?: boolean;
}
/**
 * RevertRuleResponse - Response from reverting rule
 */
export interface RevertRuleResponse {
    success: boolean;
    transactionsReverted: number;
    message?: string;
}
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
    resolution?: string;
}
/**
 * RuleEvaluationContext - Context for rule evaluation
 *
 * Contains all data needed to evaluate a rule against a transaction.
 */
export interface RuleEvaluationContext {
    transaction: any;
    currentDate: Date;
    userRules: CategoryRule[];
    cache?: Map<string, boolean>;
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
//# sourceMappingURL=ruleTypes.d.ts.map