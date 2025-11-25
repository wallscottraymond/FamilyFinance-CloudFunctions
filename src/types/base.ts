import { Timestamp } from "firebase-admin/firestore";

/**
 * Base Types - Shared across all domain models
 * These are fundamental interfaces used throughout the application
 */

// =======================
// BASE DOCUMENT INTERFACE
// =======================

/**
 * Base interface for all Firestore documents
 * Provides standard timestamp fields
 */
export interface BaseDocument {
  id?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// =======================
// HYBRID DOCUMENT STRUCTURE - NESTED OBJECTS
// =======================

/**
 * Access Control Object (NEW groupIds System)
 * Simplified access control using groupIds-based sharing
 * Access is determined by group membership checked in Firestore security rules
 */
export interface AccessControl {
  createdBy: string;              // Original creator
  ownerId: string;                // Current owner
  isPrivate: boolean;             // Quick filter: true if no group (groupIds.length === 0)
}

/**
 * Categories Object
 * Contains all categorization and classification fields
 * Supports both app categories and Plaid categories
 */
export interface Categories {
  primary: string;                // Main category
  secondary?: string;             // Sub-category
  tags: string[];                 // User-defined tags
  budgetCategory?: string;        // Budget mapping
  // Plaid-specific fields (only present in Plaid transactions)
  plaidPrimary?: string;          // Plaid primary category (e.g., "FOOD_AND_DRINK")
  plaidDetailed?: string;         // Plaid detailed category (e.g., "FOOD_AND_DRINK_RESTAURANTS")
  plaidCategories?: string[];     // Legacy Plaid category array
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
  source: string;                 // 'plaid', 'manual', 'import', 'api', etc.
  requiresApproval?: boolean;
  // Plaid-specific metadata (only present in Plaid-sourced documents)
  plaidTransactionId?: string;
  plaidAccountId?: string;
  plaidItemId?: string;
  plaidPending?: boolean;
  plaidMerchantName?: string;
  plaidName?: string;
  // Additional metadata
  notes?: string;
  lastSyncedAt?: Timestamp;
  syncError?: string;
  // Period-specific
  inheritedFrom?: string;         // For periods: parent ID they inherited from
}

/**
 * Relationships Object
 * Contains all document relationships and references
 * Tracks parent-child and linked document relationships
 */
export interface Relationships {
  parentId?: string;              // Parent document (for periods, splits, etc.)
  parentType?: string;            // Type of parent ('outflow', 'inflow', 'budget', etc.)
  childIds?: string[];            // Child documents
  budgetId?: string;              // Related budget
  accountId?: string;             // Related account
  linkedIds?: string[];           // Other linked documents
  relatedDocs?: Array<{           // Structured relationships
    type: string;
    id: string;
    relationshipType?: string;
  }>;
}

// =======================
// STANDARDIZED RESOURCE OWNERSHIP & ACCESS CONTROL
// =======================

/**
 * Standardized ownership and sharing fields for all shareable resources.
 * All resources (Transaction, Budget, Outflow, etc.) should include these fields.
 *
 * NOTE: All fields are OPTIONAL during migration to allow gradual adoption.
 * New resources should populate all fields. Existing resources can be migrated incrementally.
 */
export interface ResourceOwnership {
  // === OWNERSHIP (Optional during migration) ===
  createdBy?: string;              // User who originally created this resource
  ownerId?: string;                // Current owner (can be transferred)

  // === GROUP MEMBERSHIP (Optional during migration) ===
  groupIds?: string[];             // Groups this resource belongs to (empty array = private)
                                   // Resources can belong to multiple groups

  // === ACCESS CONTROL (Optional during migration) ===
  isPrivate?: boolean;             // Quick filter: true if groupIds.length === 0

  // === LEGACY FIELDS (Backward Compatibility - REQUIRED for existing code) ===
  userId?: string;                 // DEPRECATED - maps to ownerId
  familyId?: string;               // DEPRECATED - can be mapped to groupIds[0] for single-group scenario
  groupId?: string | null;         // DEPRECATED - can be mapped to groupIds[0] for single-group scenario
  accessibleBy?: string[];         // DEPRECATED - no longer used (access via Firestore rules)
  memberIds?: string[];            // DEPRECATED - no longer used (access via Firestore rules)
  isShared?: boolean;              // DEPRECATED - maps to !isPrivate
}

// =======================
// QUERY & API HELPERS
// =======================

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
