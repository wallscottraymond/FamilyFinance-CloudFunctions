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

import { Timestamp } from 'firebase-admin/firestore';
import {
  Budget,
  BudgetPeriod,
  BudgetPeriodDocument,
  Transaction,
  TransactionSplit,
  TransactionStatus,
  TransactionType,
  PeriodType,
  PaymentType,
  ChecklistItem,
} from '../../types';
import { TEST_USER, TEST_ACCOUNT, DEFAULTS } from './constants';
import { CATEGORIES } from './categories';
import { now, currentMonthStart, currentMonthEnd, currentMonthPeriodId } from './dateHelpers';

// ============================================================================
// TRANSACTION SPLIT FACTORY
// ============================================================================

export interface CreateTransactionSplitOptions {
  splitId?: string;
  budgetId?: string;
  budgetName?: string;
  amount: number;
  plaidPrimaryCategory?: string;
  plaidDetailedCategory?: string;
  paymentDate?: Timestamp;
  isRefund?: boolean;
  isIgnored?: boolean;
}

/**
 * Creates a properly-typed TransactionSplit
 */
export const createTestTransactionSplit = (options: CreateTransactionSplitOptions): TransactionSplit => {
  const timestamp = options.paymentDate || now();

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
    paymentType: PaymentType.REGULAR,
    paymentDate: timestamp,

    // Arrays
    rules: [],
    tags: [],

    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

// ============================================================================
// TRANSACTION FACTORY
// ============================================================================

export interface CreateTransactionOptions {
  transactionId?: string;
  amount: number;
  transactionDate?: Timestamp;
  description?: string;
  merchantName?: string;
  ownerId?: string;
  groupId?: string | null;
  accountId?: string;
  plaidPrimaryCategory?: string;
  plaidDetailedCategory?: string;
  transactionStatus?: TransactionStatus;
  type?: TransactionType;
  splits?: TransactionSplit[];
}

/**
 * Creates a properly-typed Transaction
 */
export const createTestTransaction = (options: CreateTransactionOptions): Transaction => {
  const txnId = options.transactionId || `txn_${Date.now()}`;
  const txnDate = options.transactionDate || now();
  const ownerId = options.ownerId || TEST_USER.PRIMARY;

  // Create default split if none provided
  const defaultSplit = createTestTransactionSplit({
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
    accountId: options.accountId || TEST_ACCOUNT.CHECKING,
    createdBy: ownerId,
    updatedBy: ownerId,
    currency: DEFAULTS.CURRENCY,
    description: options.description || 'Test Transaction',

    // Category fields
    internalDetailedCategory: null,
    internalPrimaryCategory: null,
    plaidDetailedCategory: options.plaidDetailedCategory || 'FOOD_AND_DRINK_GROCERIES',
    plaidPrimaryCategory: options.plaidPrimaryCategory || 'FOOD_AND_DRINK',

    // Plaid metadata
    plaidItemId: TEST_ACCOUNT.PLAID_ITEM,
    source: 'manual',
    transactionStatus: options.transactionStatus || TransactionStatus.APPROVED,

    // Type and identifiers
    type: options.type || TransactionType.EXPENSE,
    name: options.description || 'Test Transaction',
    merchantName: options.merchantName || null,

    // Splits
    splits: options.splits || [defaultSplit],

    // Initial Plaid data
    initialPlaidData: {
      plaidAccountId: options.accountId || TEST_ACCOUNT.CHECKING,
      plaidMerchantName: options.merchantName || '',
      plaidName: options.description || 'Test Transaction',
      plaidTransactionId: txnId,
      plaidPending: false,
      source: 'plaid',
    },
  };
};

// ============================================================================
// BUDGET FACTORY
// ============================================================================

export interface CreateBudgetOptions {
  id?: string;
  name: string;
  amount: number;
  categoryIds?: string[];
  period?: BudgetPeriod;
  description?: string;
  ownerId?: string;
  groupIds?: string[];
  isOngoing?: boolean;
  startDate?: Timestamp;
  endDate?: Timestamp;
  alertThreshold?: number;
}

/**
 * Creates a properly-typed Budget
 */
export const createTestBudget = (options: CreateBudgetOptions): Budget => {
  const budgetId = options.id || `budget_${Date.now()}`;
  const ownerId = options.ownerId || TEST_USER.PRIMARY;
  const startDate = options.startDate || currentMonthStart();
  const groupIds = options.groupIds || [];

  return {
    // BaseDocument fields
    id: budgetId,
    createdAt: startDate,
    updatedAt: now(),
    isActive: true,

    // Budget-specific fields
    name: options.name,
    description: options.description,
    amount: options.amount,
    currency: DEFAULTS.CURRENCY,
    categoryIds: options.categoryIds || [CATEGORIES.FOOD_GROCERIES],
    period: options.period || BudgetPeriod.MONTHLY,
    budgetType: 'recurring',
    isOngoing: options.isOngoing !== false, // Default true

    // Dates
    startDate: startDate,
    endDate: options.endDate || startDate, // Same as start for ongoing

    // Spending tracking
    spent: 0,
    remaining: options.amount,
    alertThreshold: options.alertThreshold || DEFAULTS.ALERT_THRESHOLD,

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

// ============================================================================
// BUDGET PERIOD FACTORY
// ============================================================================

export interface CreateBudgetPeriodOptions {
  budgetId: string;
  budgetName: string;
  periodType?: PeriodType;
  allocatedAmount: number;
  periodStart?: Timestamp;
  periodEnd?: Timestamp;
  ownerId?: string;
  groupIds?: string[];
  spent?: number;
}

/**
 * Creates a properly-typed BudgetPeriodDocument
 */
export const createTestBudgetPeriod = (options: CreateBudgetPeriodOptions): BudgetPeriodDocument => {
  const periodType = options.periodType || PeriodType.MONTHLY;
  const periodStart = options.periodStart || currentMonthStart();
  const periodEnd = options.periodEnd || currentMonthEnd();
  const periodId = currentMonthPeriodId();
  const ownerId = options.ownerId || TEST_USER.PRIMARY;
  const groupIds = options.groupIds || [];
  const spent = options.spent || 0;

  return {
    // BaseDocument fields
    id: `${options.budgetId}_${periodId}`,
    createdAt: periodStart,
    updatedAt: now(),
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
    lastCalculated: now(),

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

// ============================================================================
// CHECKLIST ITEM FACTORY
// ============================================================================

export interface CreateChecklistItemOptions {
  id?: string;
  name: string;
  expectedAmount: number;
  actualAmount?: number;
  isChecked?: boolean;
}

/**
 * Creates a properly-typed ChecklistItem
 */
export const createTestChecklistItem = (options: CreateChecklistItemOptions): ChecklistItem => {
  return {
    id: options.id || `checklist_${Date.now()}`,
    name: options.name,
    transactionSplit: '',
    expectedAmount: options.expectedAmount,
    actualAmount: options.actualAmount || 0,
    isChecked: options.isChecked || false,
  };
};
