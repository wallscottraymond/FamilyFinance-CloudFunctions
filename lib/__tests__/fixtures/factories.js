"use strict";
/**
 * @file factories.ts
 * @description Factory functions to create properly-typed test objects
 *
 * These factories create objects that match the actual types in src/types/index.ts.
 * They handle the complexity of the real types while providing sensible defaults.
 *
 * USAGE:
 * import { createTestBudget, createTestTransaction } from '../fixtures/factories';
 * const budget = createTestBudget({ name: 'Groceries', amount: 500 });
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestChecklistItem = exports.createTestBudgetPeriod = exports.createTestBudget = exports.createTestTransaction = exports.createTestTransactionSplit = void 0;
const types_1 = require("../../types");
const constants_1 = require("./constants");
const categories_1 = require("./categories");
const dateHelpers_1 = require("./dateHelpers");
/**
 * Creates a properly-typed TransactionSplit
 */
const createTestTransactionSplit = (options) => {
    const timestamp = options.paymentDate || (0, dateHelpers_1.now)();
    return {
        splitId: options.splitId || `split_${Date.now()}`,
        budgetId: options.budgetId || 'unassigned',
        budgetName: options.budgetName,
        // Source period IDs (null when not calculated)
        monthlyPeriodId: null,
        weeklyPeriodId: null,
        biWeeklyPeriodId: null,
        // Category information
        plaidPrimaryCategory: options.plaidPrimaryCategory || 'FOOD_AND_DRINK',
        plaidDetailedCategory: options.plaidDetailedCategory || 'FOOD_AND_DRINK_GROCERIES',
        internalPrimaryCategory: null,
        internalDetailedCategory: null,
        amount: options.amount,
        description: null,
        isDefault: true,
        // Status fields
        isIgnored: options.isIgnored || false,
        isRefund: options.isRefund || false,
        isTaxDeductible: false,
        ignoredReason: null,
        refundReason: null,
        // Payment type
        paymentType: types_1.PaymentType.REGULAR,
        paymentDate: timestamp,
        // Arrays
        rules: [],
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
    };
};
exports.createTestTransactionSplit = createTestTransactionSplit;
/**
 * Creates a properly-typed Transaction
 */
const createTestTransaction = (options) => {
    const txnId = options.transactionId || `txn_${Date.now()}`;
    const txnDate = options.transactionDate || (0, dateHelpers_1.now)();
    const ownerId = options.ownerId || constants_1.TEST_USER.PRIMARY;
    // Create default split if none provided
    const defaultSplit = (0, exports.createTestTransactionSplit)({
        splitId: `${txnId}_split_001`,
        amount: options.amount,
        plaidPrimaryCategory: options.plaidPrimaryCategory,
        plaidDetailedCategory: options.plaidDetailedCategory,
        paymentDate: txnDate,
    });
    return {
        // Document metadata
        id: txnId,
        createdAt: txnDate,
        updatedAt: txnDate,
        // Query-critical fields
        transactionId: txnId,
        ownerId: ownerId,
        groupId: options.groupId !== undefined ? options.groupId : null,
        transactionDate: txnDate,
        accountId: options.accountId || constants_1.TEST_ACCOUNT.CHECKING,
        createdBy: ownerId,
        updatedBy: ownerId,
        currency: constants_1.DEFAULTS.CURRENCY,
        description: options.description || 'Test Transaction',
        // Category fields
        internalDetailedCategory: null,
        internalPrimaryCategory: null,
        plaidDetailedCategory: options.plaidDetailedCategory || 'FOOD_AND_DRINK_GROCERIES',
        plaidPrimaryCategory: options.plaidPrimaryCategory || 'FOOD_AND_DRINK',
        // Plaid metadata
        plaidItemId: constants_1.TEST_ACCOUNT.PLAID_ITEM,
        source: 'manual',
        transactionStatus: options.transactionStatus || types_1.TransactionStatus.APPROVED,
        // Type and identifiers
        type: options.type || types_1.TransactionType.EXPENSE,
        name: options.description || 'Test Transaction',
        merchantName: options.merchantName || null,
        // Splits
        splits: options.splits || [defaultSplit],
        // Initial Plaid data
        initialPlaidData: {
            plaidAccountId: options.accountId || constants_1.TEST_ACCOUNT.CHECKING,
            plaidMerchantName: options.merchantName || '',
            plaidName: options.description || 'Test Transaction',
            plaidTransactionId: txnId,
            plaidPending: false,
            source: 'plaid',
        },
    };
};
exports.createTestTransaction = createTestTransaction;
/**
 * Creates a properly-typed Budget
 */
const createTestBudget = (options) => {
    const budgetId = options.id || `budget_${Date.now()}`;
    const ownerId = options.ownerId || constants_1.TEST_USER.PRIMARY;
    const startDate = options.startDate || (0, dateHelpers_1.currentMonthStart)();
    const groupIds = options.groupIds || [];
    return {
        // BaseDocument fields
        id: budgetId,
        createdAt: startDate,
        updatedAt: (0, dateHelpers_1.now)(),
        isActive: true,
        // Budget-specific fields
        name: options.name,
        description: options.description,
        amount: options.amount,
        currency: constants_1.DEFAULTS.CURRENCY,
        categoryIds: options.categoryIds || [categories_1.CATEGORIES.FOOD_GROCERIES],
        period: options.period || types_1.BudgetPeriod.MONTHLY,
        budgetType: 'recurring',
        isOngoing: options.isOngoing !== false, // Default true
        // Dates
        startDate: startDate,
        endDate: options.endDate || startDate, // Same as start for ongoing
        // Spending tracking
        spent: 0,
        remaining: options.amount,
        alertThreshold: options.alertThreshold || constants_1.DEFAULTS.ALERT_THRESHOLD,
        // ResourceOwnership fields
        createdBy: ownerId,
        ownerId: ownerId,
        groupIds: groupIds,
        isPrivate: groupIds.length === 0,
        // Legacy fields (for backward compatibility)
        userId: ownerId,
        familyId: groupIds[0] || '',
        groupId: groupIds[0] || null,
        // AccessControl
        access: {
            createdBy: ownerId,
            ownerId: ownerId,
            isPrivate: groupIds.length === 0,
        },
    };
};
exports.createTestBudget = createTestBudget;
/**
 * Creates a properly-typed BudgetPeriodDocument
 */
const createTestBudgetPeriod = (options) => {
    const periodType = options.periodType || types_1.PeriodType.MONTHLY;
    const periodStart = options.periodStart || (0, dateHelpers_1.currentMonthStart)();
    const periodEnd = options.periodEnd || (0, dateHelpers_1.currentMonthEnd)();
    const periodId = (0, dateHelpers_1.currentMonthPeriodId)();
    const ownerId = options.ownerId || constants_1.TEST_USER.PRIMARY;
    const groupIds = options.groupIds || [];
    const spent = options.spent || 0;
    return {
        // BaseDocument fields
        id: `${options.budgetId}_${periodId}`,
        createdAt: periodStart,
        updatedAt: (0, dateHelpers_1.now)(),
        isActive: true,
        // Budget period fields
        budgetId: options.budgetId,
        budgetName: options.budgetName,
        periodId: periodId,
        sourcePeriodId: periodId,
        // Period context
        periodType: periodType,
        periodStart: periodStart,
        periodEnd: periodEnd,
        // Budget amounts
        allocatedAmount: options.allocatedAmount,
        originalAmount: options.allocatedAmount,
        // Spending tracking
        spent: spent,
        remaining: options.allocatedAmount - spent,
        // User modifications
        isModified: false,
        // Checklist
        checklistItems: [],
        // System fields
        lastCalculated: (0, dateHelpers_1.now)(),
        // ResourceOwnership
        createdBy: ownerId,
        ownerId: ownerId,
        groupIds: groupIds,
        isPrivate: groupIds.length === 0,
        userId: ownerId,
        familyId: groupIds[0] || '',
        groupId: groupIds[0] || null,
    };
};
exports.createTestBudgetPeriod = createTestBudgetPeriod;
/**
 * Creates a properly-typed ChecklistItem
 */
const createTestChecklistItem = (options) => {
    return {
        id: options.id || `checklist_${Date.now()}`,
        name: options.name,
        transactionSplit: '',
        expectedAmount: options.expectedAmount,
        actualAmount: options.actualAmount || 0,
        isChecked: options.isChecked || false,
    };
};
exports.createTestChecklistItem = createTestChecklistItem;
//# sourceMappingURL=factories.js.map