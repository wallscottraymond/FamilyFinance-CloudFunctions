/**
 * Document Structure Utilities
 *
 * Helper functions for building standardized hybrid document structures
 * across the FamilyFinance application. All documents use query-critical
 * fields at root level with nested objects for organization.
 */

import * as admin from "firebase-admin";
import {
  AccessControl,
  Categories,
  Metadata,
  Relationships
} from "../types";

const Timestamp = admin.firestore.Timestamp;

// =======================
// ACCESS CONTROL BUILDERS
// =======================

/**
 * Build AccessControl object from user and group information
 *
 * @param createdBy - User ID who created the document
 * @param ownerId - Current owner ID (defaults to createdBy)
 * @param groupIds - Optional array of group IDs this document belongs to
 * @param isPrivate - Whether document is private (defaults to groupIds.length === 0)
 * @returns AccessControl object
 */
export function buildAccessControl(
  createdBy: string,
  ownerId?: string,
  groupIds?: string[],
  isPrivate?: boolean
): AccessControl {
  const hasGroups = groupIds && groupIds.length > 0;
  return {
    createdBy,
    ownerId: ownerId || createdBy,
    isPrivate: isPrivate !== null && isPrivate !== undefined ? isPrivate : !hasGroups
  };
}

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
export function inheritAccessControl(
  parentAccess: AccessControl,
  createdBy?: string
): AccessControl {
  // Only copy the 3 modern fields, ignoring any legacy fields
  return {
    createdBy: createdBy || parentAccess.createdBy,
    ownerId: parentAccess.ownerId,
    isPrivate: parentAccess.isPrivate
  };
}

// =======================
// CATEGORIES BUILDERS
// =======================

/**
 * Build Categories object for transactions
 *
 * @param primary - Primary category
 * @param options - Optional category fields
 * @returns Categories object
 */
export function buildTransactionCategories(
  primary: string,
  options: {
    secondary?: string;
    tags?: string[];
    budgetCategory?: string;
    plaidPrimary?: string;
    plaidDetailed?: string;
    plaidCategories?: string[];
  } = {}
): Categories & { budgetCategory?: string } {
  return {
    primary,
    secondary: options.secondary,
    tags: options.tags || [],
    budgetCategory: options.budgetCategory,
    plaidPrimary: options.plaidPrimary,
    plaidDetailed: options.plaidDetailed,
    plaidCategories: options.plaidCategories
  };
}

/**
 * Build Categories object for accounts
 *
 * @param accountType - Plaid account type
 * @param accountSubtype - Plaid account subtype
 * @param options - Optional category fields
 * @returns Categories object with account-specific fields
 */
export function buildAccountCategories(
  accountType: string,
  accountSubtype: string,
  options: {
    primary?: string;
    tags?: string[];
  } = {}
): Categories & { accountType: string; accountSubtype: string } {
  return {
    primary: options.primary || accountType,
    secondary: accountSubtype,
    tags: options.tags || [],
    accountType,
    accountSubtype
  };
}

/**
 * Inherit Categories from parent document
 *
 * @param parentCategories - Parent document's Categories object
 * @param overrides - Optional category overrides
 * @returns New Categories object inherited from parent
 */
export function inheritCategories(
  parentCategories: Categories,
  overrides: Partial<Categories> = {}
): Categories {
  return {
    ...parentCategories,
    ...overrides
  };
}

// =======================
// METADATA BUILDERS
// =======================

/**
 * Build Metadata object for new documents
 *
 * @param createdBy - User ID who created the document
 * @param source - Source of the document (e.g., 'user', 'plaid', 'system')
 * @param options - Optional metadata fields
 * @returns Metadata object
 */
export function buildMetadata(
  createdBy: string,
  source: string,
  options: {
    notes?: string;
    plaidTransactionId?: string;
    plaidAccountId?: string;
    plaidItemId?: string;
    plaidPending?: boolean;
    plaidMerchantName?: string;
    plaidName?: string;
    requiresApproval?: boolean;
    [key: string]: any;
  } = {}
): Metadata {
  return {
    updatedAt: Timestamp.now(),
    updatedBy: createdBy,
    version: 1,
    source,
    notes: options.notes,
    plaidTransactionId: options.plaidTransactionId,
    plaidAccountId: options.plaidAccountId,
    plaidItemId: options.plaidItemId,
    plaidPending: options.plaidPending,
    plaidMerchantName: options.plaidMerchantName,
    plaidName: options.plaidName,
    requiresApproval: options.requiresApproval,
    lastSyncedAt: options.source === 'plaid' ? Timestamp.now() : undefined
  };
}

/**
 * Inherit Metadata from parent document
 * Used for period documents that inherit metadata from parent
 *
 * @param parentMetadata - Parent document's Metadata object
 * @param options - Optional metadata overrides
 * @returns New Metadata object inherited from parent
 */
export function inheritMetadata(
  parentMetadata: Metadata,
  options: {
    inheritedFrom: string;
    updatedBy?: string;
    notes?: string;
    [key: string]: any;
  }
): Metadata {
  const { inheritedFrom, updatedBy, notes, ...otherOptions } = options;
  return {
    ...parentMetadata,
    updatedAt: Timestamp.now(),
    updatedBy: updatedBy || parentMetadata.updatedBy,
    version: 1, // Reset version for new period document
    inheritedFrom: inheritedFrom,  // Explicitly set to ensure TypeScript knows it's defined
    notes,
    ...otherOptions
  } as Metadata;  // Type assertion since we're adding extra properties via otherOptions
}

// =======================
// RELATIONSHIPS BUILDERS
// =======================

/**
 * Build Relationships object
 *
 * @param options - Relationship fields
 * @returns Relationships object
 */
export function buildRelationships(
  options: {
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
  } = {}
): Relationships {
  return {
    parentId: options.parentId,
    parentType: options.parentType,
    childIds: options.childIds,
    budgetId: options.budgetId,
    accountId: options.accountId,
    linkedIds: options.linkedIds,
    relatedDocs: options.relatedDocs
  };
}

// =======================
// COMPLETE DOCUMENT BUILDERS
// =======================

/**
 * Build complete hybrid document structure for a Transaction
 *
 * @param userId - User ID of document creator
 * @param groupIds - Optional array of group IDs
 * @param transactionData - Transaction-specific fields
 * @returns Complete transaction document structure
 */
export function buildTransactionDocument(
  userId: string,
  groupIds: string[],
  transactionData: {
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
  }
) {
  return {
    // Query-critical fields at root
    userId,
    groupIds,
    accountId: transactionData.accountId,
    amount: transactionData.amount,
    date: transactionData.date,
    status: transactionData.status,
    createdAt: Timestamp.now(),
    isActive: true,

    // Nested objects
    access: buildAccessControl(userId, userId, groupIds),
    categories: buildTransactionCategories(transactionData.category, {
      tags: transactionData.tags,
      plaidPrimary: transactionData.plaidData?.primaryCategory,
      plaidDetailed: transactionData.plaidData?.detailedCategory,
      plaidCategories: transactionData.plaidData?.category ? [transactionData.plaidData.category] : undefined
    }),
    metadata: buildMetadata(userId, transactionData.plaidData ? 'plaid' : 'user', {
      plaidTransactionId: transactionData.plaidData?.transactionId,
      plaidAccountId: transactionData.accountId,
      plaidMerchantName: transactionData.plaidData?.merchantName
    }),
    relationships: buildRelationships({
      accountId: transactionData.accountId,
      budgetId: transactionData.primaryBudgetId,
      linkedIds: [...(transactionData.affectedBudgets || []), ...(transactionData.affectedBudgetPeriods || [])]
    }),

    // Transaction-specific fields
    currency: transactionData.currency,
    description: transactionData.description,
    type: transactionData.type,
    splits: transactionData.splits,
    isSplit: transactionData.isSplit,
    totalAllocated: transactionData.totalAllocated,
    unallocated: transactionData.unallocated
  };
}

/**
 * Build complete hybrid document structure for an OutflowPeriod
 * Inherits access, categories, and metadata from parent outflow
 *
 * @param parentOutflow - Parent outflow document
 * @param periodData - Period-specific fields
 * @returns Complete outflow period document structure
 */
export function buildOutflowPeriodDocument(
  parentOutflow: any,
  periodData: {
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
  }
) {
  return {
    // Query-critical fields (inherited from parent)
    userId: parentOutflow.userId,
    groupIds: parentOutflow.groupIds || [],
    outflowId: parentOutflow.id,
    periodId: periodData.periodId,
    sourcePeriodId: periodData.sourcePeriodId,
    periodType: periodData.periodType,
    isActive: parentOutflow.isActive,
    status: periodData.status,
    createdAt: Timestamp.now(),
    periodStartDate: periodData.periodStartDate,
    periodEndDate: periodData.periodEndDate,

    // Nested objects (inherited from parent with period-specific overrides)
    access: inheritAccessControl(parentOutflow.access),
    categories: inheritCategories(parentOutflow.categories, {
      secondary: periodData.periodType
    }),
    metadata: inheritMetadata(parentOutflow.metadata, {
      inheritedFrom: parentOutflow.id,
      notes: `Period for ${parentOutflow.description}`
    }),
    relationships: buildRelationships({
      parentId: parentOutflow.id,
      parentType: 'outflow'
    }),

    // Period-specific fields
    cycleStartDate: periodData.cycleStartDate,
    cycleEndDate: periodData.cycleEndDate,
    cycleDays: periodData.cycleDays,
    billAmount: periodData.billAmount,
    dailyWithholdingRate: periodData.dailyWithholdingRate,
    amountWithheld: periodData.amountWithheld,
    amountDue: periodData.amountDue,
    isDuePeriod: periodData.isDuePeriod,
    dueDate: periodData.dueDate,
    expectedDueDate: periodData.expectedDueDate,
    expectedDrawDate: periodData.expectedDrawDate,
    transactionSplits: periodData.transactionSplits
  };
}

/**
 * Build complete hybrid document structure for an InflowPeriod
 * Inherits access, categories, and metadata from parent inflow
 *
 * @param parentInflow - Parent inflow document
 * @param periodData - Period-specific fields
 * @returns Complete inflow period document structure
 */
export function buildInflowPeriodDocument(
  parentInflow: any,
  periodData: {
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
  }
) {
  return {
    // Query-critical fields (inherited from parent)
    userId: parentInflow.userId,
    groupIds: parentInflow.groupIds || [],
    inflowId: parentInflow.id,
    periodId: periodData.periodId,
    sourcePeriodId: periodData.sourcePeriodId,
    periodType: periodData.periodType,
    isActive: parentInflow.isActive,
    createdAt: Timestamp.now(),
    periodStartDate: periodData.periodStartDate,
    periodEndDate: periodData.periodEndDate,

    // Nested objects (inherited from parent with period-specific overrides)
    access: inheritAccessControl(parentInflow.access),
    categories: inheritCategories(parentInflow.categories, {
      secondary: periodData.periodType
    }),
    metadata: inheritMetadata(parentInflow.metadata, {
      inheritedFrom: parentInflow.id,
      notes: `Period for ${parentInflow.description}`
    }),
    relationships: buildRelationships({
      parentId: parentInflow.id,
      parentType: 'inflow'
    }),

    // Period-specific fields
    cycleStartDate: periodData.cycleStartDate,
    cycleEndDate: periodData.cycleEndDate,
    cycleDays: periodData.cycleDays,
    incomeAmount: periodData.incomeAmount,
    dailyEarningRate: periodData.dailyEarningRate,
    amountEarned: periodData.amountEarned,
    amountReceived: periodData.amountReceived,
    isReceiptPeriod: periodData.isReceiptPeriod,
    receiptDate: periodData.receiptDate
  };
}

// =======================
// TRANSACTION UPDATE HELPERS
// =======================

/**
 * Build Firestore update object for modified Plaid transactions
 * Ensures consistency with hybrid structure for transaction updates
 *
 * @param plaidTransaction - Modified transaction data from Plaid
 * @param existingTransaction - Current transaction document data
 * @returns Firestore update object with proper field paths
 */
export function buildPlaidTransactionUpdate(
  plaidTransaction: any,
  existingTransaction?: any
): Record<string, any> {
  const updates: Record<string, any> = {
    // Update root query-critical fields
    amount: Math.abs(plaidTransaction.amount),
    updatedAt: Timestamp.now(),

    // Update nested metadata fields (using dot notation for Firestore)
    'metadata.updatedAt': Timestamp.now(),
    'metadata.plaidPending': plaidTransaction.pending,
    'metadata.plaidMerchantName': plaidTransaction.merchant_name,
    'metadata.plaidName': plaidTransaction.name,
  };

  // Update description at root
  if (plaidTransaction.merchant_name || plaidTransaction.name) {
    updates.description = plaidTransaction.merchant_name || plaidTransaction.name || 'Bank Transaction';
  }

  // Update nested metadata location if present
  if (plaidTransaction.location) {
    updates['metadata.location'] = {
      name: plaidTransaction.location.address || undefined,
      address: plaidTransaction.location.address || undefined,
      latitude: plaidTransaction.location.lat || undefined,
      longitude: plaidTransaction.location.lon || undefined,
    };
  }

  // Update nested categories plaidCategories array
  if (plaidTransaction.category) {
    updates['categories.plaidCategories'] = plaidTransaction.category;
  }

  // Update nested metadata.plaidData if it exists in the document
  if (existingTransaction?.metadata?.plaidData) {
    updates['metadata.plaidData.amount'] = plaidTransaction.amount;
    updates['metadata.plaidData.merchantName'] = plaidTransaction.merchant_name;
    updates['metadata.plaidData.description'] = plaidTransaction.name;
    updates['metadata.plaidData.pending'] = plaidTransaction.pending;
    updates['metadata.plaidData.date'] = plaidTransaction.date
      ? Timestamp.fromDate(new Date(plaidTransaction.date))
      : Timestamp.now();

    // Update personal finance category if available
    if (plaidTransaction.personal_finance_category) {
      updates['metadata.plaidData.personalFinanceCategory'] = {
        primary: plaidTransaction.personal_finance_category.primary,
        detailed: plaidTransaction.personal_finance_category.detailed,
        confidenceLevel: plaidTransaction.personal_finance_category.confidence_level
      };
    }
  }

  return updates;
}

/**
 * Build Firestore update object for transaction deletion (soft delete)
 * Marks transaction as deleted while preserving data
 *
 * @param reason - Reason for deletion
 * @returns Firestore update object
 */
export function buildTransactionDeletionUpdate(reason: string = 'Transaction removed by institution'): Record<string, any> {
  return {
    // Update root status field
    status: 'DELETED',
    isActive: false,
    updatedAt: Timestamp.now(),

    // Update nested metadata
    'metadata.updatedAt': Timestamp.now(),
    'metadata.deletedAt': Timestamp.now(),
    'metadata.deletedByPlaid': true,
    'metadata.plaidRemovalReason': reason,
  };
}
