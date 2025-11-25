"use strict";
/**
 * Document Structure Utilities
 *
 * Helper functions for building standardized hybrid document structures
 * across the FamilyFinance application. All documents use query-critical
 * fields at root level with nested objects for organization.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAccessControl = buildAccessControl;
exports.inheritAccessControl = inheritAccessControl;
exports.buildTransactionCategories = buildTransactionCategories;
exports.buildAccountCategories = buildAccountCategories;
exports.inheritCategories = inheritCategories;
exports.buildMetadata = buildMetadata;
exports.inheritMetadata = inheritMetadata;
exports.buildRelationships = buildRelationships;
exports.buildTransactionDocument = buildTransactionDocument;
exports.buildOutflowPeriodDocument = buildOutflowPeriodDocument;
exports.buildInflowPeriodDocument = buildInflowPeriodDocument;
exports.buildPlaidTransactionUpdate = buildPlaidTransactionUpdate;
exports.buildTransactionDeletionUpdate = buildTransactionDeletionUpdate;
const admin = __importStar(require("firebase-admin"));
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
function buildAccessControl(createdBy, ownerId, groupIds, isPrivate) {
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
function inheritAccessControl(parentAccess, createdBy) {
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
function buildTransactionCategories(primary, options = {}) {
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
function buildAccountCategories(accountType, accountSubtype, options = {}) {
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
function inheritCategories(parentCategories, overrides = {}) {
    return Object.assign(Object.assign({}, parentCategories), overrides);
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
function buildMetadata(createdBy, source, options = {}) {
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
function inheritMetadata(parentMetadata, options) {
    const { inheritedFrom, updatedBy, notes } = options, otherOptions = __rest(options, ["inheritedFrom", "updatedBy", "notes"]);
    return Object.assign(Object.assign(Object.assign({}, parentMetadata), { updatedAt: Timestamp.now(), updatedBy: updatedBy || parentMetadata.updatedBy, version: 1, inheritedFrom: inheritedFrom, // Explicitly set to ensure TypeScript knows it's defined
        notes }), otherOptions); // Type assertion since we're adding extra properties via otherOptions
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
function buildRelationships(options = {}) {
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
function buildTransactionDocument(userId, groupIds, transactionData) {
    var _a, _b, _c, _d, _e;
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
            plaidPrimary: (_a = transactionData.plaidData) === null || _a === void 0 ? void 0 : _a.primaryCategory,
            plaidDetailed: (_b = transactionData.plaidData) === null || _b === void 0 ? void 0 : _b.detailedCategory,
            plaidCategories: ((_c = transactionData.plaidData) === null || _c === void 0 ? void 0 : _c.category) ? [transactionData.plaidData.category] : undefined
        }),
        metadata: buildMetadata(userId, transactionData.plaidData ? 'plaid' : 'user', {
            plaidTransactionId: (_d = transactionData.plaidData) === null || _d === void 0 ? void 0 : _d.transactionId,
            plaidAccountId: transactionData.accountId,
            plaidMerchantName: (_e = transactionData.plaidData) === null || _e === void 0 ? void 0 : _e.merchantName
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
function buildOutflowPeriodDocument(parentOutflow, periodData) {
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
function buildInflowPeriodDocument(parentInflow, periodData) {
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
function buildPlaidTransactionUpdate(plaidTransaction, existingTransaction) {
    var _a;
    const updates = {
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
    if ((_a = existingTransaction === null || existingTransaction === void 0 ? void 0 : existingTransaction.metadata) === null || _a === void 0 ? void 0 : _a.plaidData) {
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
function buildTransactionDeletionUpdate(reason = 'Transaction removed by institution') {
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
//# sourceMappingURL=documentStructure.js.map