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
import { Budget, BudgetPeriod, BudgetPeriodDocument, Transaction, TransactionSplit, TransactionStatus, TransactionType, PeriodType, ChecklistItem } from '../../types';
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
export declare const createTestTransactionSplit: (options: CreateTransactionSplitOptions) => TransactionSplit;
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
export declare const createTestTransaction: (options: CreateTransactionOptions) => Transaction;
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
export declare const createTestBudget: (options: CreateBudgetOptions) => Budget;
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
export declare const createTestBudgetPeriod: (options: CreateBudgetPeriodOptions) => BudgetPeriodDocument;
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
export declare const createTestChecklistItem: (options: CreateChecklistItemOptions) => ChecklistItem;
//# sourceMappingURL=factories.d.ts.map