/**
 * Document Structure Utilities
 *
 * Helper functions for building standardized hybrid document structures
 * across the FamilyFinance application. All documents use query-critical
 * fields at root level with nested objects for organization.
 */
import * as admin from "firebase-admin";
import { AccessControl, Categories, Metadata, Relationships } from "../types";
/**
 * Build AccessControl object from user and group information
 *
 * @param createdBy - User ID who created the document
 * @param ownerId - Current owner ID (defaults to createdBy)
 * @param groupIds - Optional array of group IDs this document belongs to
 * @param isPrivate - Whether document is private (defaults to groupIds.length === 0)
 * @returns AccessControl object
 */
export declare function buildAccessControl(createdBy: string, ownerId?: string, groupIds?: string[], isPrivate?: boolean): AccessControl;
/**
 * REMOVED: calculateAccessibleBy() and enhanceWithGroupSharing()
 *
 * These functions are no longer needed as we've moved to a groupIds-based
 * sharing model where access is determined by group membership checks in
 * Firestore security rules, not denormalized accessibleBy arrays.
 *
 * See /FamilyFinance-CloudFunctions/SHARING.md for the new architecture.
 */
/**
 * Inherit AccessControl from parent document
 * Used for period documents that inherit permissions from parent
 *
 * IMPORTANT: Filters out deprecated legacy fields (permissions, sharedWith, roleOverrides)
 * to ensure clean access control structure
 *
 * @param parentAccess - Parent document's AccessControl object
 * @param createdBy - Optional override for createdBy field
 * @returns New AccessControl object inherited from parent (only modern fields)
 */
export declare function inheritAccessControl(parentAccess: AccessControl, createdBy?: string): AccessControl;
/**
 * Build Categories object for transactions
 *
 * @param primary - Primary category
 * @param options - Optional category fields
 * @returns Categories object
 */
export declare function buildTransactionCategories(primary: string, options?: {
    secondary?: string;
    tags?: string[];
    budgetCategory?: string;
    plaidPrimary?: string;
    plaidDetailed?: string;
    plaidCategories?: string[];
}): Categories & {
    budgetCategory?: string;
};
/**
 * Build Categories object for accounts
 *
 * @param accountType - Plaid account type
 * @param accountSubtype - Plaid account subtype
 * @param options - Optional category fields
 * @returns Categories object with account-specific fields
 */
export declare function buildAccountCategories(accountType: string, accountSubtype: string, options?: {
    primary?: string;
    tags?: string[];
}): Categories & {
    accountType: string;
    accountSubtype: string;
};
/**
 * Inherit Categories from parent document
 *
 * @param parentCategories - Parent document's Categories object
 * @param overrides - Optional category overrides
 * @returns New Categories object inherited from parent
 */
export declare function inheritCategories(parentCategories: Categories, overrides?: Partial<Categories>): Categories;
/**
 * Build Metadata object for new documents
 *
 * @param createdBy - User ID who created the document
 * @param source - Source of the document (e.g., 'user', 'plaid', 'system')
 * @param options - Optional metadata fields
 * @returns Metadata object
 */
export declare function buildMetadata(createdBy: string, source: string, options?: {
    notes?: string;
    plaidTransactionId?: string;
    plaidAccountId?: string;
    plaidItemId?: string;
    plaidPending?: boolean;
    plaidMerchantName?: string;
    plaidName?: string;
    requiresApproval?: boolean;
    [key: string]: any;
}): Metadata;
/**
 * Inherit Metadata from parent document
 * Used for period documents that inherit metadata from parent
 *
 * @param parentMetadata - Parent document's Metadata object
 * @param options - Optional metadata overrides
 * @returns New Metadata object inherited from parent
 */
export declare function inheritMetadata(parentMetadata: Metadata, options: {
    inheritedFrom: string;
    updatedBy?: string;
    notes?: string;
    [key: string]: any;
}): Metadata;
/**
 * Build Relationships object
 *
 * @param options - Relationship fields
 * @returns Relationships object
 */
export declare function buildRelationships(options?: {
    parentId?: string;
    parentType?: string;
    childIds?: string[];
    budgetId?: string;
    accountId?: string;
    linkedIds?: string[];
    relatedDocs?: Array<{
        type: string;
        id: string;
        relationshipType?: string;
    }>;
}): Relationships;
/**
 * Build complete hybrid document structure for a Transaction
 *
 * @param userId - User ID of document creator
 * @param groupIds - Optional array of group IDs
 * @param transactionData - Transaction-specific fields
 * @returns Complete transaction document structure
 */
export declare function buildTransactionDocument(userId: string, groupIds: string[], transactionData: {
    accountId?: string;
    amount: number;
    currency: string;
    description: string;
    category: string;
    type: string;
    date: admin.firestore.Timestamp;
    status: string;
    splits: any[];
    isSplit: boolean;
    totalAllocated: number;
    unallocated: number;
    affectedBudgets: string[];
    affectedBudgetPeriods: string[];
    primaryBudgetId?: string;
    primaryBudgetPeriodId?: string;
    tags?: string[];
    plaidData?: any;
}): {
    userId: string;
    groupIds: string[];
    accountId: string | undefined;
    amount: number;
    date: admin.firestore.Timestamp;
    status: string;
    createdAt: admin.firestore.Timestamp;
    isActive: boolean;
    access: AccessControl;
    categories: Categories & {
        budgetCategory?: string;
    };
    metadata: Metadata;
    relationships: Relationships;
    currency: string;
    description: string;
    type: string;
    splits: any[];
    isSplit: boolean;
    totalAllocated: number;
    unallocated: number;
};
/**
 * Build complete hybrid document structure for an OutflowPeriod
 * Inherits access, categories, and metadata from parent outflow
 *
 * @param parentOutflow - Parent outflow document
 * @param periodData - Period-specific fields
 * @returns Complete outflow period document structure
 */
export declare function buildOutflowPeriodDocument(parentOutflow: any, periodData: {
    periodId: string;
    sourcePeriodId: string;
    periodType: string;
    periodStartDate: admin.firestore.Timestamp;
    periodEndDate: admin.firestore.Timestamp;
    cycleStartDate: admin.firestore.Timestamp;
    cycleEndDate: admin.firestore.Timestamp;
    cycleDays: number;
    billAmount: number;
    dailyWithholdingRate: number;
    amountWithheld: number;
    amountDue: number;
    isDuePeriod: boolean;
    dueDate?: admin.firestore.Timestamp;
    expectedDueDate: admin.firestore.Timestamp;
    expectedDrawDate: admin.firestore.Timestamp;
    status: string;
    transactionSplits: any[];
}): {
    userId: any;
    groupIds: any;
    outflowId: any;
    periodId: string;
    sourcePeriodId: string;
    periodType: string;
    isActive: any;
    status: string;
    createdAt: admin.firestore.Timestamp;
    periodStartDate: admin.firestore.Timestamp;
    periodEndDate: admin.firestore.Timestamp;
    access: AccessControl;
    categories: Categories;
    metadata: Metadata;
    relationships: Relationships;
    cycleStartDate: admin.firestore.Timestamp;
    cycleEndDate: admin.firestore.Timestamp;
    cycleDays: number;
    billAmount: number;
    dailyWithholdingRate: number;
    amountWithheld: number;
    amountDue: number;
    isDuePeriod: boolean;
    dueDate: admin.firestore.Timestamp | undefined;
    expectedDueDate: admin.firestore.Timestamp;
    expectedDrawDate: admin.firestore.Timestamp;
    transactionSplits: any[];
};
/**
 * Build complete hybrid document structure for an InflowPeriod
 * Inherits access, categories, and metadata from parent inflow
 *
 * @param parentInflow - Parent inflow document
 * @param periodData - Period-specific fields
 * @returns Complete inflow period document structure
 */
export declare function buildInflowPeriodDocument(parentInflow: any, periodData: {
    periodId: string;
    sourcePeriodId: string;
    periodType: string;
    periodStartDate: admin.firestore.Timestamp;
    periodEndDate: admin.firestore.Timestamp;
    cycleStartDate: admin.firestore.Timestamp;
    cycleEndDate: admin.firestore.Timestamp;
    cycleDays: number;
    incomeAmount: number;
    dailyEarningRate: number;
    amountEarned: number;
    amountReceived: number;
    isReceiptPeriod: boolean;
    receiptDate?: admin.firestore.Timestamp;
}): {
    userId: any;
    groupIds: any;
    inflowId: any;
    periodId: string;
    sourcePeriodId: string;
    periodType: string;
    isActive: any;
    createdAt: admin.firestore.Timestamp;
    periodStartDate: admin.firestore.Timestamp;
    periodEndDate: admin.firestore.Timestamp;
    access: AccessControl;
    categories: Categories;
    metadata: Metadata;
    relationships: Relationships;
    cycleStartDate: admin.firestore.Timestamp;
    cycleEndDate: admin.firestore.Timestamp;
    cycleDays: number;
    incomeAmount: number;
    dailyEarningRate: number;
    amountEarned: number;
    amountReceived: number;
    isReceiptPeriod: boolean;
    receiptDate: admin.firestore.Timestamp | undefined;
};
/**
 * Build Firestore update object for modified Plaid transactions
 * Ensures consistency with hybrid structure for transaction updates
 *
 * @param plaidTransaction - Modified transaction data from Plaid
 * @param existingTransaction - Current transaction document data
 * @returns Firestore update object with proper field paths
 */
export declare function buildPlaidTransactionUpdate(plaidTransaction: any, existingTransaction?: any): Record<string, any>;
/**
 * Build Firestore update object for transaction deletion (soft delete)
 * Marks transaction as deleted while preserving data
 *
 * @param reason - Reason for deletion
 * @returns Firestore update object
 */
export declare function buildTransactionDeletionUpdate(reason?: string): Record<string, any>;
//# sourceMappingURL=documentStructure.d.ts.map