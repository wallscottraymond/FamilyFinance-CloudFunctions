import { Timestamp } from "firebase-admin/firestore";
/**
 * Base Types - Shared across all domain models
 * These are fundamental interfaces used throughout the application
 */
/**
 * Base interface for all Firestore documents
 * Provides standard timestamp fields
 */
export interface BaseDocument {
    id?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
/**
 * Access Control Object (NEW groupIds System)
 * Simplified access control using groupIds-based sharing
 * Access is determined by group membership checked in Firestore security rules
 */
export interface AccessControl {
    createdBy: string;
    ownerId: string;
    isPrivate: boolean;
}
/**
 * Categories Object
 * Contains all categorization and classification fields
 * Supports both app categories and Plaid categories
 */
export interface Categories {
    primary: string;
    secondary?: string;
    tags: string[];
    budgetCategory?: string;
    plaidPrimary?: string;
    plaidDetailed?: string;
    plaidCategories?: string[];
}
/**
 * Metadata Object
 * Contains all audit trail and document lifecycle fields
 * Includes source tracking and version control
 */
export interface Metadata {
    updatedAt: Timestamp;
    updatedBy?: string;
    version: number;
    source: string;
    requiresApproval?: boolean;
    plaidTransactionId?: string;
    plaidAccountId?: string;
    plaidItemId?: string;
    plaidPending?: boolean;
    plaidMerchantName?: string;
    plaidName?: string;
    notes?: string;
    lastSyncedAt?: Timestamp;
    syncError?: string;
    inheritedFrom?: string;
}
/**
 * Relationships Object
 * Contains all document relationships and references
 * Tracks parent-child and linked document relationships
 */
export interface Relationships {
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
}
/**
 * Standardized ownership and sharing fields for all shareable resources.
 * All resources (Transaction, Budget, Outflow, etc.) should include these fields.
 *
 * NOTE: All fields are OPTIONAL during migration to allow gradual adoption.
 * New resources should populate all fields. Existing resources can be migrated incrementally.
 */
export interface ResourceOwnership {
    createdBy?: string;
    ownerId?: string;
    groupIds?: string[];
    isPrivate?: boolean;
    userId?: string;
    familyId?: string;
    groupId?: string | null;
    accessibleBy?: string[];
    memberIds?: string[];
    isShared?: boolean;
}
/**
 * Firestore query options for pagination and filtering
 */
export interface QueryOptions {
    limit?: number;
    offset?: number;
    orderBy?: string;
    orderDirection?: "asc" | "desc";
    where?: WhereClause[];
}
/**
 * Where clause for Firestore queries
 */
export interface WhereClause {
    field: string;
    operator: FirebaseFirestore.WhereFilterOp;
    value: any;
}
/**
 * Standard API error response
 */
export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, any>;
}
/**
 * Standard function response wrapper
 */
export interface FunctionResponse<T = any> {
    success: boolean;
    data?: T;
    error?: ApiError;
    timestamp: string;
}
//# sourceMappingURL=base.d.ts.map