import { Timestamp } from "firebase-admin/firestore";
import { SystemRole } from "./users";
import { GroupMembership } from "./groups";

// Export new modular types
export * from "./users";
export * from "./groups";
export * from "./sharing";
export * from "./outflowSummaries";

// Base interface for all documents
export interface BaseDocument {
  id?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// =======================
// HYBRID DOCUMENT STRUCTURE - NESTED OBJECTS
// =======================

/**
 * Access Control Object
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

// User related types
export interface User extends BaseDocument {
  email: string;
  displayName: string;
  photoURL?: string;

  // RBAC fields (NEW - optional during migration)
  systemRole?: SystemRole;          // System-level role
  groupMemberships?: GroupMembership[]; // Groups user belongs to
  demoAccountId?: string;           // For demo_user role

  // Legacy fields (DEPRECATED but REQUIRED for backward compatibility)
  familyId?: string;                // DEPRECATED - use groupMemberships instead
  role: UserRole;                   // DEPRECATED - use systemRole instead (REQUIRED for existing code)

  preferences: UserPreferences;
  isActive: boolean;
}

// Legacy enum - kept for backward compatibility
export enum UserRole {
  ADMIN = "admin",
  EDITOR = "editor",
  VIEWER = "viewer"
}

export interface UserPreferences {
  currency: string;
  locale: string;
  notifications: NotificationSettings;
  theme: "light" | "dark" | "auto";
  privacy: PrivacySettings;
  display: DisplaySettings;
  accessibility: AccessibilitySettings;
  financial: FinancialSettings;
  security: SecuritySettings;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  transactionAlerts: boolean;
  budgetAlerts: boolean;
  weeklyReports: boolean;
  monthlyReports: boolean;
  goalReminders: boolean;
  billReminders: boolean;
  accountBalanceAlerts: boolean;
  suspiciousActivityAlerts: boolean;
  familyInvitations: boolean;
}

export interface PrivacySettings {
  shareSpendingWithFamily: boolean;
  shareGoalsWithFamily: boolean;
  allowFamilyToSeeTransactionDetails: boolean;
  showProfileToFamilyMembers: boolean;
  dataRetentionPeriod: number; // in days
  allowAnalytics: boolean;
  allowMarketingEmails: boolean;
}

export interface DisplaySettings {
  dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
  timeFormat: "12h" | "24h";
  numberFormat: "US" | "EU" | "IN"; // 1,234.56 | 1.234,56 | 1,23,456.78
  showCentsInDisplays: boolean;
  defaultTransactionView: "list" | "cards" | "table";
  chartPreferences: ChartPreferences;
  dashboardLayout: string[]; // Array of widget IDs in order
}

export interface ChartPreferences {
  defaultChartType: "line" | "bar" | "pie" | "doughnut";
  showGridLines: boolean;
  animateCharts: boolean;
  colorScheme: "default" | "colorblind" | "high_contrast";
}

export interface AccessibilitySettings {
  fontSize: "small" | "medium" | "large" | "extra_large";
  highContrast: boolean;
  reduceMotion: boolean;
  screenReaderOptimized: boolean;
  voiceOverEnabled: boolean;
  hapticFeedback: boolean;
  longPressDelay: number; // in milliseconds
}

export interface FinancialSettings {
  defaultTransactionCategory: TransactionCategory;
  autoCategorizationEnabled: boolean;
  roundUpSavings: boolean;
  roundUpSavingsGoalId?: string;
  budgetStartDay: number; // 1-31, day of month when budget period starts
  showNetWorth: boolean;
  hiddenAccounts: string[]; // Account IDs to hide from main view
  defaultBudgetAlertThreshold: number; // percentage 0-100
  enableSpendingLimits: boolean;
  dailySpendingLimit?: number;
  weeklySpendingLimit?: number;
  monthlySpendingLimit?: number;
}

export interface SecuritySettings {
  biometricAuthEnabled: boolean;
  pinAuthEnabled: boolean;
  autoLockTimeout: number; // in minutes, 0 for never
  requireAuthForTransactions: boolean;
  requireAuthForBudgetChanges: boolean;
  requireAuthForGoalChanges: boolean;
  sessionTimeout: number; // in minutes
  allowedDevices: string[]; // Device IDs that are authorized
  twoFactorAuthEnabled: boolean;
  backupPhoneNumber?: string;
  lastPasswordChange?: string; // ISO date string
  suspiciousActivityDetection: boolean;
}

// Family related types
export interface Family extends BaseDocument {
  name: string;
  description?: string;
  adminUserId: string;
  memberIds: string[];
  inviteCodes: InviteCode[];
  settings: FamilySettings;
  isActive: boolean;
}

export interface InviteCode {
  code: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  role: UserRole;
  usedBy?: string;
  isActive: boolean;
}

export interface FamilySettings {
  currency: string;
  budgetPeriod: "weekly" | "monthly" | "yearly";
  requireApprovalForExpenses: boolean;
  expenseApprovalLimit: number;
  allowViewerTransactions: boolean;
}

// Transaction related types
// Payment Type enum for transaction splits
export enum PaymentType {
  REGULAR = 'regular',                    // Normal payment for the period
  CATCH_UP = 'catch_up',                  // Payment covering past-due periods
  ADVANCE = 'advance',                    // Payment for future periods
  EXTRA_PRINCIPAL = 'extra_principal'     // Additional payment beyond required amount
}

// Transaction Split interface for splitting transactions across budgets AND outflows
// UPDATED: Flat structure with renamed fields for consistency
export interface TransactionSplit {
  splitId: string;                // Unique identifier for the split (renamed from 'id')
  budgetId: string;               // Reference to budgets collection ('unassigned' if not assigned)
  budgetName?: string;            // Budget name for display purposes (optional, populated by backend)

  // Source period IDs based on transaction date (always populated)
  monthlyPeriodId: string | null;        // Monthly source period ID containing transaction date
  weeklyPeriodId: string | null;         // Weekly source period ID containing transaction date
  biWeeklyPeriodId: string | null;       // Bi-weekly source period ID containing transaction date

  // Assignment references (populated when assigned)
  outflowId?: string | null;             // Reference to outflows collection (when assigned to outflow)

  // Category information - UPDATED with new field names
  plaidPrimaryCategory: string;          // Plaid primary category (e.g., "FOOD_AND_DRINK")
  plaidDetailedCategory: string;         // Plaid detailed category (e.g., "FOOD_AND_DRINK_RESTAURANTS")
  internalPrimaryCategory: string | null;   // User override primary category
  internalDetailedCategory: string | null;  // User override detailed category

  amount: number;                 // Amount allocated to this split
  description?: string | null;           // Optional override description for this split
  isDefault: boolean;             // True for the auto-created split when transaction is created

  // Enhanced status fields for budget tracking
  isIgnored?: boolean;            // User marked to ignore from budget tracking
  isRefund?: boolean;             // Transaction is a refund (subtract from spending)
  isTaxDeductible?: boolean;      // Tax-deductible expense
  ignoredReason?: string | null;         // Why user ignored this split
  refundReason?: string | null;          // Reason for refund classification

  // Payment type tracking for outflow assignments
  paymentType?: PaymentType;      // Payment classification (regular, catch_up, advance, extra_principal)
  paymentDate: Timestamp;        // Date when payment was made (matches transaction.transactionDate)

  // New array fields
  rules: string[];                // Rule IDs applied to this split
  tags: string[];                 // User-defined tags for this split

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// NEW FLAT TRANSACTION INTERFACE - Optimized for Firestore indexing
export interface Transaction extends BaseDocument {
  // === DOCUMENT METADATA (inherited from BaseDocument) ===
  id: string;                     // Firestore document ID (same as transactionId)
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // === QUERY-CRITICAL FIELDS AT ROOT ===
  transactionId: string;          // Plaid transaction_id (used as Firestore document ID)
  ownerId: string;                // User who owns this transaction (renamed from userId)
  groupId: string | null;         // Group this transaction belongs to (null = private)
  transactionDate: Timestamp;     // Transaction date (renamed from 'date')
  accountId: string;              // Plaid account ID
  createdBy: string;              // User who created this transaction
  updatedBy: string;              // User who last updated this transaction
  currency: string;               // ISO currency code (e.g., "USD")
  description: string;            // Transaction description

  // === CATEGORY FIELDS (flattened from nested object) ===
  internalDetailedCategory: string | null;   // User override detailed category
  internalPrimaryCategory: string | null;    // User override primary category
  plaidDetailedCategory: string;   // Plaid detailed category
  plaidPrimaryCategory: string;    // Plaid primary category

  // === PLAID METADATA (flattened from nested metadata object) ===
  plaidItemId: string;            // Plaid item ID
  source: 'plaid' | 'manual' | 'import'; // Transaction source
  transactionStatus: TransactionStatus;  // Transaction status (renamed from 'status')

  // === TYPE AND IDENTIFIERS ===
  type: TransactionType | null;   // Transaction type (income, expense, transfer)
  name: string;                   // Transaction name from Plaid
  merchantName: string | null;    // Merchant name from Plaid

  // === SPLITS ARRAY ===
  splits: TransactionSplit[];     // Array of transaction splits

  // === INITIAL PLAID DATA (preserved for reference) ===
  initialPlaidData: {
    plaidAccountId: string;
    plaidMerchantName: string;
    plaidName: string;
    plaidTransactionId: string;
    plaidPending: boolean;
    source: 'plaid';
  };
}

export enum TransactionType {
  INCOME = "income",
  EXPENSE = "expense",
  TRANSFER = "transfer"
}

export enum TransactionStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
  CANCELLED = "cancelled"
}

export enum TransactionCategory {
  // Income categories
  SALARY = "salary",
  ALLOWANCE = "allowance",
  INVESTMENT = "investment",
  GIFT = "gift",
  OTHER_INCOME = "other_income",
  
  // Expense categories
  FOOD = "food",
  TRANSPORTATION = "transportation",
  HOUSING = "housing",
  UTILITIES = "utilities",
  HEALTHCARE = "healthcare",
  EDUCATION = "education",
  ENTERTAINMENT = "entertainment",
  CLOTHING = "clothing",
  PERSONAL_CARE = "personal_care",
  SAVINGS = "savings",
  DEBT_PAYMENT = "debt_payment",
  INSURANCE = "insurance",
  TAXES = "taxes",
  CHARITY = "charity",
  OTHER_EXPENSE = "other_expense"
}

// Enhanced Category interface matching frontend structure
export interface Category extends BaseDocument {
  name: string;
  primary_plaid_category: string;
  detailed_plaid_category: string;
  description: string;
  type: 'Income' | 'Outflow';
  second_category: string;
  first_category: string;
  overall_category: string;
  visible_by_default: boolean;
  budget_selection: boolean;
  income_selection: boolean;
  index: number;
  
  // Lifecycle management fields
  isActive: boolean; // Default true, set to false to disable without deleting
  isSystemCategory: boolean; // True for default categories, false for custom user categories
  createdBy?: string; // User ID who created this category (for custom categories)
  
  // Enhanced mapping field for backend compatibility
  transactionCategoryId?: string; // Direct mapping to backend transaction processing
}

export interface TransactionLocation {
  name?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

// Budget related types
export interface Budget extends BaseDocument, ResourceOwnership {
  name: string;
  description?: string;

  // === NESTED OBJECTS (Hybrid Structure) ===
  access: AccessControl;      // Nested access control object
  categories?: Categories;    // Optional categories (budgets may not need full categorization)
  metadata?: Metadata;        // Optional metadata
  relationships?: Relationships; // Optional relationships

  // Budget configuration
  amount: number;
  currency: string;
  categoryIds: string[]; // Changed from categories to categoryIds - references to categories collection
  period: BudgetPeriod;
  startDate: Timestamp;
  endDate: Timestamp; // Legacy field - kept for backward compatibility
  spent: number;
  remaining: number;
  alertThreshold: number; // Percentage (0-100)
  isActive: boolean;

  // New fields for budget periods integration
  budgetType: 'recurring' | 'limited';
  endPeriod?: string; // For limited budgets - final period ID
  totalPeriods?: number; // For limited budgets - how many periods
  selectedStartPeriod?: string; // Period ID where user wants budget to start
  activePeriodRange?: {
    startPeriod: string; // First period ID with budget_periods created
    endPeriod: string;   // Last period ID with budget_periods created
  };
  lastExtended?: Timestamp; // When budget_periods were last extended

  // Budget end date functionality
  isOngoing: boolean; // True for ongoing budgets, false for budgets with fixed end dates
  budgetEndDate?: Timestamp; // Specific end date when isOngoing is false

  // System budget flag
  isSystemEverythingElse?: boolean; // Flag for "everything else" catch-all budget
}

export enum BudgetPeriod {
  WEEKLY = "weekly",
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  YEARLY = "yearly",
  CUSTOM = "custom"
}

// Recurring transaction types
export interface RecurringTransaction extends BaseDocument {
  userId: string;
  familyId: string;
  templateTransaction: Omit<Transaction, "id" | "date" | "recurringTransactionId">;
  frequency: RecurrenceFrequency;
  nextExecutionDate: Timestamp;
  endDate?: Timestamp;
  isActive: boolean;
  executionCount: number;
  maxExecutions?: number;
}

export enum RecurrenceFrequency {
  DAILY = "daily",
  WEEKLY = "weekly",
  BIWEEKLY = "biweekly",
  MONTHLY = "monthly",
  QUARTERLY = "quarterly",
  YEARLY = "yearly"
}

// Notification types
export interface Notification extends BaseDocument {
  userId: string;
  familyId?: string;
  title: string;
  body: string;
  type: NotificationType;
  data: Record<string, any>;
  read: boolean;
  readAt?: Timestamp;
  priority: NotificationPriority;
}

export enum NotificationType {
  TRANSACTION_CREATED = "transaction_created",
  TRANSACTION_APPROVED = "transaction_approved",
  TRANSACTION_REJECTED = "transaction_rejected",
  BUDGET_EXCEEDED = "budget_exceeded",
  BUDGET_WARNING = "budget_warning",
  FAMILY_INVITATION = "family_invitation",
  WEEKLY_REPORT = "weekly_report",
  SYSTEM_ANNOUNCEMENT = "system_announcement"
}

export enum NotificationPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  URGENT = "urgent"
}

// API Request/Response types
export interface CreateTransactionRequest {
  amount: number;
  description: string;
  category: string;              // Category ID from categories collection
  type: TransactionType;
  date?: string; // ISO date string
  location?: TransactionLocation;
  tags?: string[];
  budgetId?: string;
  groupId?: string;              // NEW: Group this transaction belongs to (optional)
}

export interface UpdateTransactionRequest {
  amount?: number;
  description?: string;
  category?: string;             // Category ID from categories collection
  location?: TransactionLocation;
  tags?: string[];
  splits?: TransactionSplit[];   // Transaction splits
  transactionDate?: string | Timestamp; // Transaction date
}

// Transaction Splitting Request/Response types
export interface AddTransactionSplitRequest {
  transactionId: string;
  budgetId: string;
  amount: number;
  categoryId?: TransactionCategory;
  description?: string;

  // Enhanced status fields
  isIgnored?: boolean;
  isRefund?: boolean;
  isTaxDeductible?: boolean;
  ignoredReason?: string;
  refundReason?: string;
  taxDeductibleCategory?: string;
  excludedFromBudgets?: string[];
  manualBudgetAssignment?: boolean;

  // Period-type-specific outflow assignments
  outflowMonthlyPeriodId?: string;
  outflowWeeklyPeriodId?: string;
  outflowBiWeeklyPeriodId?: string;
}

export interface UpdateTransactionSplitRequest {
  transactionId: string;
  splitId: string;
  budgetId?: string;
  amount?: number;
  categoryId?: TransactionCategory;
  description?: string;

  // Enhanced status fields
  isIgnored?: boolean;
  isRefund?: boolean;
  isTaxDeductible?: boolean;
  ignoredReason?: string;
  refundReason?: string;
  taxDeductibleCategory?: string;
  excludedFromBudgets?: string[];
  manualBudgetAssignment?: boolean;

  // Period-type-specific outflow assignments
  outflowMonthlyPeriodId?: string;
  outflowWeeklyPeriodId?: string;
  outflowBiWeeklyPeriodId?: string;
}

export interface DeleteTransactionSplitRequest {
  transactionId: string;
  splitId: string;
}

export interface TransactionSplitResponse {
  success: boolean;
  split?: TransactionSplit;
  transaction?: Transaction;
  message?: string;
}

// Enhanced Split Status Management Request/Response types
export interface MarkSplitStatusRequest {
  transactionId: string;
  splitId: string;
  isIgnored?: boolean;
  isRefund?: boolean;
  isTaxDeductible?: boolean;
  ignoredReason?: string;
  refundReason?: string;
  taxDeductibleCategory?: string;
}

export interface BulkUpdateSplitStatusRequest {
  updates: Array<{
    transactionId: string;
    splitId: string;
    isIgnored?: boolean;
    isRefund?: boolean;
    isTaxDeductible?: boolean;
    ignoredReason?: string;
    refundReason?: string;
    taxDeductibleCategory?: string;
  }>;
}

export interface RecalculateBudgetSpendingRequest {
  budgetPeriodId: string;
  forceRecalculation?: boolean; // Force recalculation even if recent
}

export interface BudgetSpendingResponse {
  success: boolean;
  budgetPeriodId: string;
  previousSpentAmount: number;
  newSpentAmount: number;
  affectedTransactions: number;
  calculatedAt: string; // ISO timestamp
  message?: string;
}

export interface CreateBudgetRequest {
  name: string;
  description?: string;
  amount: number;
  categoryIds: string[]; // Changed from categories to categoryIds - references to categories collection
  period: BudgetPeriod;
  budgetType?: 'recurring' | 'limited'; // Budget type
  startDate: string; // ISO date string
  endDate?: string; // ISO date string - Legacy field for backward compatibility
  alertThreshold?: number;
  memberIds?: string[]; // Optional - for shared budgets only (DEPRECATED)
  isShared?: boolean; // Optional - defaults to false (individual budget) (DEPRECATED)
  groupId?: string; // NEW: Group this budget belongs to (optional)
  selectedStartPeriod?: string; // Optional - specific period ID to start budget periods from

  // Budget end date functionality
  isOngoing?: boolean; // Optional - defaults to true (ongoing budget)
  budgetEndDate?: string; // Optional - ISO date string for budget end date when isOngoing is false
}

export interface CreateFamilyRequest {
  name: string;
  description?: string;
  settings?: Partial<FamilySettings>;
}

export interface JoinFamilyRequest {
  inviteCode: string;
}

// Error types
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

// Firestore query helpers
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  where?: WhereClause[];
}

export interface WhereClause {
  field: string;
  operator: FirebaseFirestore.WhereFilterOp;
  value: any;
}

// Source Period types for budget periods
export interface SourcePeriod extends BaseDocument {
  periodId: string;     // Same as id for easy reference  
  type: PeriodType;     // "monthly" | "weekly" | "bi_monthly"
  startDate: Timestamp; // UTC timestamp
  endDate: Timestamp;   // UTC timestamp
  year: number;         // 2024
  index: number;        // Sequential: 202406, 202423, etc.
  isCurrent: boolean;   // True for current period of each type
  metadata: {
    month?: number;        // 1-12 for monthly/bi-monthly
    weekNumber?: number;   // US week number for weekly (Sunday start)
    biMonthlyHalf?: 1 | 2; // First/second half for bi-monthly
    weekStartDay: 0;       // Always 0 (Sunday) for US families
  };
}

export enum PeriodType {
  WEEKLY = "weekly",
  MONTHLY = "monthly", 
  BI_MONTHLY = "bi_monthly"
}

// Checklist item for budget periods
export interface ChecklistItem {
  id: string;                   // Unique identifier for the checklist item
  name: string;
  transactionSplit: string;     // Placeholder for future transaction splitting functionality
  expectedAmount: number;
  actualAmount: number;
  isChecked: boolean;
}

// Budget Periods - Links budgets to specific source periods with proportional amounts
// NOTE: Budget periods INHERIT ownership from parent budget (no separate ownership)
export interface BudgetPeriodDocument extends BaseDocument, ResourceOwnership {
  budgetId: string;           // Reference to budgets collection
  budgetName: string;         // Denormalized budget name for performance
  periodId: string;           // Reference to source_periods.id (same as sourcePeriodId)
  sourcePeriodId: string;     // Direct reference to source_periods.id for mapping
  
  // Period context (denormalized from source_periods for performance)
  periodType: PeriodType;     // "weekly" | "monthly" | "bi_monthly"
  periodStart: Timestamp;     // UTC timestamp
  periodEnd: Timestamp;       // UTC timestamp
  
  // Budget amounts
  allocatedAmount: number;    // Proportionally calculated amount for this period
  originalAmount: number;     // Store original calculation for reference

  // Spending tracking (calculated by updateBudgetSpending utility)
  spent?: number;             // Current amount spent (calculated from transactions)
  remaining?: number;         // Remaining amount (allocatedAmount - spent)

  // User modifications (only by owner or family managers)
  userNotes?: string;         // User-added notes for this period
  modifiedAmount?: number;    // If user overrode the calculated amount
  isModified: boolean;        // Has user manually adjusted the amount?
  lastModifiedBy?: string;    // Track who made changes
  lastModifiedAt?: Timestamp; // When last modified
  
  // Checklist functionality
  checklistItems: ChecklistItem[];  // Array of checklist items for this budget period
  
  // System fields
  lastCalculated: Timestamp;  // When allocatedAmount was last calculated
  isActive: boolean;          // Whether this budget period is active
}

// Function response types
export interface FunctionResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: string;
}

// =======================
// PLAID INTEGRATION TYPES
// =======================

// Plaid Items - represents the connection between user and financial institution
export interface PlaidItem extends BaseDocument {
  itemId: string; // Plaid item_id
  userId: string; // Family Finance user ID
  familyId?: string; // Optional family association
  institutionId: string; // Plaid institution_id
  institutionName: string; // Human-readable institution name
  institutionLogo?: string; // Institution logo URL from Plaid
  accessToken: string; // ENCRYPTED Plaid access token
  cursor?: string; // For transaction sync pagination (modern /transactions/sync)
  products: PlaidProduct[]; // Products enabled for this item
  availableProducts: PlaidProduct[]; // Products available but not yet enabled
  billedProducts: PlaidProduct[]; // Products being billed
  status: PlaidItemStatus;
  error?: PlaidItemError; // Current error state if any
  consentExpirationTime?: Timestamp; // When user consent expires
  lastWebhookReceived?: Timestamp; // Last webhook received for this item
  updateMode?: PlaidUpdateMode; // How this item should be updated
  isActive: boolean; // Whether this item is active and should be synced

  // Enhanced sync optimization fields
  syncFrequency: PlaidSyncFrequency; // User-selected sync frequency preference
  lastSyncedAt?: Timestamp; // Last successful sync completion time
  lastFullSyncAt?: Timestamp; // Last full historical sync (for cursor resets)
  syncStats: PlaidSyncStats; // Performance and cost tracking statistics
  nextScheduledSync?: Timestamp; // Next scheduled sync time (for non-webhook modes)
  webhookEnabled: boolean; // Whether webhooks are configured for this item
}

export enum PlaidProduct {
  TRANSACTIONS = "transactions",
  ACCOUNTS = "accounts", 
  IDENTITY = "identity",
  ASSETS = "assets",
  LIABILITIES = "liabilities",
  INVESTMENTS = "investments",
  AUTH = "auth",
  INCOME = "income"
}

export enum PlaidItemStatus {
  GOOD = "ITEM_LOGIN_REQUIRED", // Item is in good state
  LOGIN_REQUIRED = "ITEM_LOGIN_REQUIRED", // User needs to update login credentials
  PENDING_EXPIRATION = "PENDING_EXPIRATION", // Item will expire soon
  EXPIRED = "EXPIRED", // Item has expired
  ERROR = "ERROR" // Item is in error state
}

export interface PlaidItemError {
  errorType: string; // Plaid error type (e.g., "ITEM_ERROR", "INVALID_CREDENTIALS")
  errorCode: string; // Specific error code from Plaid
  displayMessage?: string; // User-friendly error message
  lastOccurredAt: Timestamp;
  retryCount: number; // Number of automatic retry attempts
}

export enum PlaidUpdateMode {
  WEBHOOK = "webhook", // Update via webhooks (preferred)
  POLLING = "polling", // Update via scheduled polling
  MANUAL = "manual" // Manual update only
}

// Enhanced sync frequency options for cost optimization
export enum PlaidSyncFrequency {
  REAL_TIME = "real_time",     // Immediate webhook response + on-demand refresh
  STANDARD = "standard",       // Multiple daily updates via webhooks
  ECONOMY = "economy",         // Daily batch updates only
  MANUAL = "manual"           // User-triggered sync only
}

// Sync statistics for cost and performance tracking
export interface PlaidSyncStats {
  totalApiCalls: number;       // Total API calls made
  totalTransactionsProcessed: number; // Total transactions processed
  lastSyncDuration: number;    // Last sync duration in milliseconds
  averageSyncDuration: number; // Average sync duration
  errorCount: number;          // Number of sync errors
  lastErrorAt?: Timestamp;     // When the last error occurred
  costTier: PlaidSyncFrequency; // Current cost/frequency tier
}

// Plaid Accounts - bank accounts, credit cards, etc.
export interface PlaidAccount extends BaseDocument {
  // === QUERY-CRITICAL FIELDS AT ROOT (for composite indexes) ===
  userId: string;                 // Family Finance user ID (REQUIRED for existing queries)
  groupId: string | null;         // Group this account belongs to (null = private) (REQUIRED for existing queries)
  accessibleBy: string[];         // Denormalized array of user IDs who can access (REQUIRED for array-contains queries)
  accountId: string;              // Plaid account_id (REQUIRED for filtering)
  itemId: string;                 // Reference to plaid_items document (REQUIRED for filtering)
  isActive: boolean;              // Whether this account should be included in transactions (REQUIRED for filtering)
  createdAt: Timestamp;           // Creation timestamp (REQUIRED for sorting, inherited from BaseDocument)

  // === NESTED ACCESS CONTROL OBJECT ===
  access: AccessControl;          // Access control and sharing fields

  // === NESTED CATEGORIES OBJECT ===
  categories: Categories & {      // Account categorization (extends base Categories)
    // Account-specific category fields
    accountType: PlaidAccountType;     // Account type for categorization
    accountSubtype: PlaidAccountSubtype; // Account subtype
  };

  // === NESTED METADATA OBJECT ===
  metadata: Metadata & {          // Audit trail and metadata (extends base Metadata)
    // Account-specific metadata
    persistentAccountId?: string; // Plaid persistent_account_id for tracking across reconnections
    verificationStatus?: PlaidVerificationStatus;
    isSyncEnabled: boolean;       // Whether to sync transactions for this account
    lastSyncedAt?: Timestamp;     // Last time transactions were synced
    institution: {
      id: string;                 // Institution ID
      name: string;               // Institution name
      logo?: string;              // Institution logo URL
    };
    linkedAt: Timestamp;          // When account was first linked
    lastBalanceUpdate: Timestamp; // Last time balance was updated
  };

  // === NESTED RELATIONSHIPS OBJECT ===
  relationships: Relationships;   // Document relationships

  // === ACCOUNT-SPECIFIC FIELDS AT ROOT ===
  name: string;                   // Account name from institution
  mask?: string;                  // Account number mask (e.g., "0000")
  officialName?: string;          // Official account name from institution
  balances: PlaidAccountBalances; // Current balance information
}

export enum PlaidAccountType {
  DEPOSITORY = "depository", // Checking, savings, etc.
  CREDIT = "credit", // Credit cards, lines of credit
  LOAN = "loan", // Mortgages, auto loans, etc.
  INVESTMENT = "investment", // Investment accounts
  OTHER = "other" // Other account types
}

export enum PlaidAccountSubtype {
  // Depository subtypes
  CHECKING = "checking",
  SAVINGS = "savings",
  HSA = "hsa",
  CD = "cd",
  MONEY_MARKET = "money market",
  PAYPAL = "paypal",
  PREPAID = "prepaid",
  
  // Credit subtypes  
  CREDIT_CARD = "credit card",
  PAYPAL_CREDIT = "paypal credit",
  
  // Loan subtypes
  AUTO = "auto",
  COMMERCIAL = "commercial", 
  CONSTRUCTION = "construction",
  CONSUMER = "consumer",
  HOME_EQUITY = "home equity",
  MORTGAGE = "mortgage",
  OVERDRAFT = "overdraft",
  LINE_OF_CREDIT = "line of credit",
  STUDENT = "student",
  
  // Investment subtypes
  INVESTMENT_401A = "401a",
  INVESTMENT_401K = "401k", 
  INVESTMENT_403B = "403b",
  INVESTMENT_457B = "457b",
  INVESTMENT_529 = "529",
  BROKERAGE = "brokerage",
  CASH_ISA = "cash isa",
  EDUCATION_SAVINGS_ACCOUNT = "education savings account",
  FIXED_ANNUITY = "fixed annuity",
  GIC = "gic",
  HEALTH_REIMBURSEMENT_ARRANGEMENT = "health reimbursement arrangement",
  IRA = "ira",
  ISA = "isa",
  KEOGH = "keogh",
  LIF = "lif",
  LIFE_INSURANCE = "life insurance",
  LIRA = "lira",
  LRIF = "lrif",
  LRSP = "lrsp",
  NON_CUSTODIAL_WALLET = "non-custodial wallet",
  NON_TAXABLE_INVESTMENT_ACCOUNT = "non-taxable investment account",
  PENSION = "pension",
  PLAN = "plan",
  PRIF = "prif",
  PROFIT_SHARING_PLAN = "profit sharing plan",
  RDSP = "rdsp",
  RESP = "resp",
  RETIREMENT = "retirement",
  RLIF = "rlif",
  ROTH = "roth",
  ROTH_401K = "roth 401k",
  RRIF = "rrif",
  RRSP = "rrsp",
  SARSEP = "sarsep",
  SEP_IRA = "sep ira",
  SIMPLE_IRA = "simple ira",
  SIPP = "sipp",
  STOCK_PLAN = "stock plan",
  TFSA = "tfsa",
  TRUST = "trust",
  UGMA = "ugma",
  UTMA = "utma",
  VARIABLE_ANNUITY = "variable annuity",
  
  // Other
  OTHER = "other"
}

export interface PlaidAccountBalances {
  available?: number; // Available balance (null for credit/loan accounts)
  current: number; // Current balance
  limit?: number; // Credit limit (for credit accounts)
  isoCurrencyCode?: string; // ISO currency code (e.g., "USD")
  unofficialCurrencyCode?: string; // Unofficial currency code if ISO not available
  lastUpdated: Timestamp; // When balance was last updated
}

export enum PlaidVerificationStatus {
  PENDING_AUTOMATIC_VERIFICATION = "pending_automatic_verification",
  PENDING_MANUAL_VERIFICATION = "pending_manual_verification", 
  MANUALLY_VERIFIED = "manually_verified",
  VERIFICATION_EXPIRED = "verification_expired",
  VERIFICATION_FAILED = "verification_failed",
  DATABASE_MATCHED = "database_matched",
  DATABASE_INSIGHTS_PASS = "database_insights_pass",
  DATABASE_INSIGHTS_PASS_WITH_CAUTION = "database_insights_pass_with_caution",
  DATABASE_INSIGHTS_FAIL = "database_insights_fail"
}

// Plaid Transactions - individual transactions from bank accounts
export interface PlaidTransaction extends BaseDocument {
  transactionId: string; // Plaid transaction_id
  accountId: string; // Reference to plaid_accounts document
  itemId: string; // Reference to plaid_items document
  userId: string; // Family Finance user ID
  familyId?: string; // Optional family association
  persistentTransactionId?: string; // Plaid persistent_transaction_id
  amount: number; // Transaction amount (positive for outflows, negative for inflows)
  isoCurrencyCode?: string; // ISO currency code
  unofficialCurrencyCode?: string; // Unofficial currency code if ISO not available
  category: string[]; // Plaid category hierarchy (e.g., ["Food and Drink", "Restaurants"])
  categoryId: string; // Plaid category_id
  checkNumber?: string; // Check number if applicable
  dateTransacted: Timestamp; // Date when transaction occurred (YYYY-MM-DD from Plaid)
  datePosted: Timestamp; // Date when transaction posted to account
  location?: PlaidTransactionLocation; // Transaction location data
  merchantName?: string; // Merchant name
  merchantEntityId?: string; // Plaid merchant entity ID
  originalDescription?: string; // Original transaction description
  paymentMeta: PlaidPaymentMeta; // Payment metadata
  pending: boolean; // Whether transaction is pending
  pendingTransactionId?: string; // ID of pending transaction this updates
  accountOwner?: string; // Account owner (for business accounts)
  authorizedDate?: Timestamp; // Date transaction was authorized
  authorizedDatetime?: Timestamp; // Datetime transaction was authorized
  datetime?: Timestamp; // Datetime of transaction (if available)
  paymentChannel: PlaidPaymentChannel; // How payment was made
  personalFinanceCategory?: PlaidPersonalFinanceCategory; // Enhanced categorization
  transactionCode?: PlaidTransactionCode; // Institution-specific transaction code
  transactionType?: PlaidTransactionType; // Type of transaction
  
  // Family Finance specific fields
  isProcessed: boolean; // Whether this has been processed into a family transaction
  familyTransactionId?: string; // ID of corresponding family transaction
  isHidden: boolean; // Whether user has hidden this transaction
  userCategory?: TransactionCategory; // User-assigned category override
  userNotes?: string; // User-added notes
  tags: string[]; // User-added tags
  
  // Sync metadata
  lastSyncedAt: Timestamp; // When this transaction was last synced from Plaid
  syncVersion: number; // Version for optimistic concurrency control
}

export interface PlaidTransactionLocation {
  address?: string;
  city?: string;
  region?: string; // State/province
  postalCode?: string;
  country?: string;
  lat?: number;
  lon?: number;
  storeNumber?: string;
}

export interface PlaidPaymentMeta {
  byOrderOf?: string;
  payee?: string;
  payer?: string; 
  paymentMethod?: string;
  paymentProcessor?: string;
  ppdId?: string;
  reason?: string;
  referenceNumber?: string;
}

export enum PlaidPaymentChannel {
  ONLINE = "online",
  IN_STORE = "in store", 
  ATM = "atm",
  KIOSK = "kiosk",
  MOBILE = "mobile",
  MAIL = "mail",
  TELEPHONE = "telephone",
  OTHER = "other"
}

export interface PlaidPersonalFinanceCategory {
  primary: string; // Primary category (e.g., "FOOD_AND_DRINK")
  detailed: string; // Detailed category (e.g., "FOOD_AND_DRINK_RESTAURANTS")
  confidenceLevel?: string; // Plaid's confidence in categorization
}

export enum PlaidTransactionCode {
  ADJUSTMENT = "adjustment",
  ATM = "atm",
  BANK_CHARGE = "bank charge",
  BILL_PAYMENT = "bill payment", 
  CASH = "cash",
  CASHBACK = "cashback",
  CHEQUE = "cheque",
  DIRECT_DEBIT = "direct debit",
  INTEREST = "interest",
  PURCHASE = "purchase",
  STANDING_ORDER = "standing order",
  TRANSFER = "transfer",
  NULL = "null"
}

export enum PlaidTransactionType {
  DIGITAL = "digital",
  PLACE = "place",
  SPECIAL = "special",
  UNRESOLVED = "unresolved"
}

// Plaid Webhooks - for tracking webhook events and ensuring idempotency
export interface PlaidWebhook extends BaseDocument {
  webhookType: PlaidWebhookType;
  webhookCode: PlaidWebhookCode;
  itemId?: string; // Item ID if webhook is item-specific
  environmentId: string; // Plaid environment (sandbox/development/production)
  requestId: string; // Plaid request ID for debugging
  payload: Record<string, any>; // Full webhook payload
  processedAt?: Timestamp; // When webhook was successfully processed
  processingStatus: PlaidWebhookProcessingStatus;
  processingError?: string; // Error message if processing failed
  retryCount: number; // Number of processing attempts
  signature: string; // Webhook signature for verification
  isValid: boolean; // Whether signature was valid
}

export enum PlaidWebhookType {
  TRANSACTIONS = "TRANSACTIONS",
  ITEM = "ITEM", 
  AUTH = "AUTH",
  IDENTITY = "IDENTITY",
  ASSETS = "ASSETS",
  HOLDINGS = "HOLDINGS",
  INVESTMENTS_TRANSACTIONS = "INVESTMENTS_TRANSACTIONS",
  LIABILITIES = "LIABILITIES",
  TRANSFER = "TRANSFER",
  BANK_TRANSFER = "BANK_TRANSFER",
  INCOME = "INCOME",
  SIGNAL = "SIGNAL",
  RECURRING_TRANSACTIONS = "RECURRING_TRANSACTIONS"
}

export enum PlaidWebhookCode {
  // TRANSACTIONS webhooks
  SYNC_UPDATES_AVAILABLE = "SYNC_UPDATES_AVAILABLE",
  DEFAULT_UPDATE = "DEFAULT_UPDATE",
  INITIAL_UPDATE = "INITIAL_UPDATE",
  HISTORICAL_UPDATE = "HISTORICAL_UPDATE",
  TRANSACTIONS_REMOVED = "TRANSACTIONS_REMOVED",
  
  // ITEM webhooks
  ERROR = "ERROR",
  PENDING_EXPIRATION = "PENDING_EXPIRATION",
  USER_PERMISSION_REVOKED = "USER_PERMISSION_REVOKED",
  WEBHOOK_UPDATE_ACKNOWLEDGED = "WEBHOOK_UPDATE_ACKNOWLEDGED",
  NEW_ACCOUNTS_AVAILABLE = "NEW_ACCOUNTS_AVAILABLE",
  
  // RECURRING_TRANSACTIONS webhooks
  RECURRING_TRANSACTIONS_UPDATE = "RECURRING_TRANSACTIONS_UPDATE"
}

export enum PlaidWebhookProcessingStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped"
}

// Modern /transactions/sync API types
export interface PlaidTransactionsSyncRequest {
  access_token: string;
  cursor?: string; // Null for initial sync, or cursor from previous response
  count?: number; // Number of transactions to fetch (default 100, max 500)
  account_ids?: string[]; // Optional: specific accounts to sync
}

export interface PlaidTransactionsSyncResponse {
  added: PlaidTransactionSync[]; // New transactions
  modified: PlaidTransactionSync[]; // Updated transactions
  removed: PlaidRemovedTransaction[]; // Deleted transactions
  next_cursor: string; // Cursor for next sync request
  has_more: boolean; // Whether more data is available for pagination
  request_id: string; // Plaid request ID for debugging
}

export interface PlaidTransactionSync {
  account_id: string;
  account_owner?: string;
  amount: number;
  authorized_date?: string;
  authorized_datetime?: string;
  category: string[];
  category_id?: string;
  check_number?: string;
  counterparties?: Array<{
    name: string;
    type: string;
    logo_url?: string;
  }>;
  date: string;
  datetime?: string;
  iso_currency_code?: string;
  location?: {
    address?: string;
    city?: string;
    region?: string;
    postal_code?: string;
    country?: string;
    lat?: number;
    lon?: number;
    store_number?: string;
  };
  merchant_name?: string;
  merchant_entity_id?: string;
  name: string;
  original_description?: string;
  payment_meta?: Record<string, any>;
  pending: boolean;
  pending_transaction_id?: string;
  personal_finance_category?: {
    confidence_level: string;
    detailed: string;
    primary: string;
  };
  transaction_code?: string;
  transaction_id: string;
  transaction_type?: string;
  unofficial_currency_code?: string;
}

export interface PlaidRemovedTransaction {
  transaction_id: string;
}

// Enhanced sync result for modern API
export interface ModernSyncResult {
  itemId: string;
  userId: string;
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  newCursor: string;
  hasMore: boolean;
  errors: string[];
  processingTimeMs: number;
  apiCallsUsed: number; // Cost tracking
}

// Plaid Configuration - app-level Plaid settings
export interface PlaidConfiguration extends BaseDocument {
  clientId: string; // Plaid client ID
  environment: PlaidEnvironment; // Current environment
  products: PlaidProduct[]; // Enabled products
  countryCodes: string[]; // Supported country codes
  webhookUrl?: string; // Webhook endpoint URL
  isActive: boolean; // Whether Plaid integration is active
  
  // Rate limiting and sync settings
  syncSettings: {
    maxTransactionDays: number; // How many days of transactions to sync
    frontendTransactionDays: number; // How many days to load in frontend (30)
    syncFrequency: PlaidSyncFrequency; // How often to sync
    enableWebhooks: boolean; // Whether to use webhooks for real-time updates
    enableScheduledSync: boolean; // Whether to use scheduled sync as backup
  };
  
  // Security settings
  encryptionSettings: {
    algorithm: string; // Encryption algorithm for access tokens
    keyRotationDays: number; // How often to rotate encryption keys
  };
  
  // Error handling
  errorHandling: {
    maxRetries: number; // Max retries for failed operations
    retryDelayMs: number; // Delay between retries
    errorReportingEnabled: boolean; // Whether to report errors to monitoring
  };
}

export enum PlaidEnvironment {
  SANDBOX = "sandbox",
  DEVELOPMENT = "development", 
  PRODUCTION = "production"
}

// Duplicate enum removed - using the one defined earlier

// API Request/Response types for Plaid integration
export interface CreatePlaidLinkTokenRequest {
  userId: string;
  clientName?: string;
  countryCodes?: string[];
  language?: string;
  products?: PlaidProduct[];
  accountFilters?: Record<string, any>;
  redirectUri?: string;
  androidPackageName?: string;
}

export interface ExchangePlaidPublicTokenRequest {
  publicToken: string;
  institutionId: string;
  institutionName: string;
  accountIds?: string[]; // Specific accounts to enable
}

export interface SyncPlaidTransactionsRequest {
  itemId?: string; // Sync specific item, or all if not provided
  accountId?: string; // Sync specific account
  startDate?: string; // Start date for sync (ISO date)
  endDate?: string; // End date for sync (ISO date)
  forceFullSync?: boolean; // Force full sync instead of incremental
}

export interface PlaidTransactionSyncResponse {
  itemId: string;
  accountsCount: number;
  transactionsAdded: number;
  transactionsModified: number;
  transactionsRemoved: number;
  cursor?: string; // New cursor for next sync
  hasMore: boolean; // Whether more data is available
}

export interface PlaidItemStatusResponse {
  itemId: string;
  institutionName: string;
  accountsCount: number;
  status: PlaidItemStatus;
  lastSyncedAt?: string;
  error?: PlaidItemError;
  products: PlaidProduct[];
  billedProducts: PlaidProduct[];
}

// =======================
// RECURRING TRANSACTIONS TYPES - ROOT COLLECTIONS
// =======================

// Base interface for recurring income and outflow transactions
export interface BaseRecurringTransaction extends BaseDocument, ResourceOwnership {
  // === QUERY-CRITICAL FIELDS AT ROOT (for composite indexes) ===
  userId: string;                 // Family Finance user ID (REQUIRED for existing queries)
  groupId: string | null;         // Group this recurring transaction belongs to (null = private) (REQUIRED for existing queries)
  accessibleBy: string[];         // Denormalized array of user IDs who can access (REQUIRED for array-contains queries)
  streamId: string;               // Plaid recurring stream ID (REQUIRED for filtering)
  itemId: string;                 // Reference to plaid_items document (REQUIRED for filtering)
  accountId: string;              // Primary account where this recurring stream appears (REQUIRED for filtering)
  isActive: boolean;              // Whether this stream is still active (REQUIRED for filtering)
  status: PlaidRecurringTransactionStatus; // Current status of the stream (REQUIRED for filtering)
  createdAt: Timestamp;           // Creation timestamp (REQUIRED for sorting, inherited from BaseDocument)

  // === NESTED ACCESS CONTROL OBJECT ===
  access: AccessControl;          // Access control and sharing fields

  // === NESTED CATEGORIES OBJECT ===
  categories: Categories & {      // Recurring transaction categorization (extends base Categories)
    // Recurring transaction-specific category fields
    plaidCategoryHierarchy: string[]; // Plaid category hierarchy (e.g., ["Food and Drink", "Restaurants"])
    plaidCategoryId: string;      // Plaid category_id
    personalFinanceCategory?: PlaidPersonalFinanceCategory; // Enhanced categorization
    userCategory?: TransactionCategory; // User-assigned category override
  };

  // === NESTED METADATA OBJECT ===
  metadata: Metadata & {          // Audit trail and metadata (extends base Metadata)
    // Recurring transaction-specific metadata
    isUserModified?: boolean;     // Whether user has manually modified this stream
    isHidden: boolean;            // Whether user has hidden this recurring transaction
    syncVersion: number;          // Version for optimistic concurrency control
  };

  // === NESTED RELATIONSHIPS OBJECT ===
  relationships: Relationships & { // Document relationships (extends base Relationships)
    // Recurring transaction-specific relationship fields
    transactionIds: string[];     // IDs of transactions that are part of this stream
  };

  // === RECURRING TRANSACTION-SPECIFIC FIELDS AT ROOT ===
  description: string;            // Recurring transaction description
  merchantName?: string;          // Merchant name if available

  // Amount information (FLAT STRUCTURE)
  averageAmount: number;          // Average amount (flat structure)
  lastAmount: number;             // Most recent amount (flat structure)

  // Frequency and timing
  frequency: PlaidRecurringFrequency; // How often this recurs

  // Historical data
  firstDate: Timestamp;           // Date of first transaction in stream
  lastDate: Timestamp;            // Date of last transaction in stream
  predictedNextDate?: Timestamp;  // Plaid's ML prediction of next occurrence
}

// Recurring Income - stored in root 'inflow' collection
export interface RecurringIncome extends BaseRecurringTransaction {
  // Income-specific fields can be added here
  incomeType?: 'salary' | 'dividend' | 'interest' | 'rental' | 'freelance' | 'bonus' | 'other';
  isRegularSalary?: boolean; // True for primary salary income
  employerName?: string; // Employer or payer name
  taxable?: boolean; // Whether this income is taxable
  inflowSource?: 'user' | 'plaid'; // Source of this inflow
}

// Recurring Outflows - stored in root 'outflows' collection
export interface RecurringOutflow extends BaseRecurringTransaction {
  // Outflow-specific fields can be added here
  expenseType?: 'subscription' | 'utility' | 'loan' | 'rent' | 'insurance' | 'tax' | 'other';
  isEssential?: boolean; // True for essential expenses (rent, utilities)
  merchantCategory?: string; // Standardized merchant category
  isCancellable?: boolean; // Whether this can be easily cancelled
  reminderDays?: number; // Days before due date to remind
  outflowSource?: 'user' | 'plaid'; // Source of this outflow
}

// Legacy interface for backward compatibility - maps to both collections
export interface PlaidRecurringTransaction extends BaseRecurringTransaction {
  streamType: PlaidRecurringTransactionStreamType; // Inflow or outflow - used to determine target collection
}

export enum PlaidRecurringTransactionStatus {
  MATURE = "MATURE", // Has at least 3 transactions and regular cadence
  EARLY_DETECTION = "EARLY_DETECTION" // First appears before becoming mature
}

export enum PlaidRecurringTransactionStreamType {
  INFLOW = "inflow", // Money coming in (income, refunds, etc.)
  OUTFLOW = "outflow" // Money going out (expenses, bills, etc.)
}

/**
 * @deprecated LEGACY TYPE - DO NOT USE FOR NEW CODE
 * This is the RAW Plaid API response format (nested structure).
 *
 * ❌ DO NOT use this for Firestore documents!
 * ✅ USE flat structure instead:
 *    averageAmount: number (not an object!)
 *    lastAmount: number (not an object!)
 *    currency: string
 *
 * See RecurringOutflow and RecurringIncome interfaces for correct structure.
 * This type exists only for Plaid API data transformation.
 */
export interface PlaidRecurringAmount {
  amount: number; // Transaction amount
  isoCurrencyCode?: string; // ISO currency code
  unofficialCurrencyCode?: string; // Unofficial currency code if ISO not available
}

export enum PlaidRecurringFrequency {
  UNKNOWN = "UNKNOWN",
  WEEKLY = "WEEKLY", 
  BIWEEKLY = "BIWEEKLY",
  SEMI_MONTHLY = "SEMI_MONTHLY",
  MONTHLY = "MONTHLY",
  ANNUALLY = "ANNUALLY"
}

// Plaid Recurring Transaction Update Events - tracks webhook updates
export interface PlaidRecurringTransactionUpdate extends BaseDocument {
  itemId: string; // Reference to plaid_items document
  userId: string; // Family Finance user ID
  updateType: PlaidRecurringUpdateType; // Type of update
  streamId?: string; // Specific stream ID if applicable
  
  // Update payload from webhook
  payload: Record<string, any>; // Full webhook payload
  processedAt?: Timestamp; // When update was processed
  processingStatus: PlaidWebhookProcessingStatus;
  processingError?: string; // Error message if processing failed
  
  // Changes made - now tracks both collections separately
  changesApplied: {
    incomeStreamsAdded: number; // Income streams added
    incomeStreamsModified: number; // Income streams modified
    incomeStreamsRemoved: number; // Income streams removed
    outflowStreamsAdded: number; // Outflow streams added
    outflowStreamsModified: number; // Outflow streams modified
    outflowStreamsRemoved: number; // Outflow streams removed
    transactionsAffected: number; // Total transactions affected
  };
}

export enum PlaidRecurringUpdateType {
  INITIAL_DETECTION = "INITIAL_DETECTION", // First time recurring streams detected
  STREAM_UPDATES = "STREAM_UPDATES", // Updates to existing streams
  NEW_STREAMS = "NEW_STREAMS", // New recurring streams detected
  STREAM_MODIFICATIONS = "STREAM_MODIFICATIONS" // Changes to stream classification
}

// API Request/Response types for recurring transactions
export interface FetchRecurringTransactionsRequest {
  itemId?: string; // Fetch for specific item, or all if not provided
  accountId?: string; // Fetch for specific account
}

export interface FetchRecurringTransactionsResponse {
  itemId: string;
  accountsCount: number;
  streamsFound: number;
  streamsAdded: number;
  streamsModified: number;
  incomeStreamsAdded: number; // Income streams added to 'inflow' collection
  outflowStreamsAdded: number; // Outflow streams added to 'outflows' collection
  incomeStreamsModified: number; // Income streams modified
  outflowStreamsModified: number; // Outflow streams modified
  historicalTransactionsDays: number; // How many days of history were analyzed
}

// Combined response for getting both income and outflows
export interface GetUserRecurringTransactionsResponse {
  income: RecurringIncome[];
  outflows: RecurringOutflow[];
  totalIncome: number; // Total monthly income
  totalOutflows: number; // Total monthly outflows
  netFlow: number; // Monthly net cash flow
}

/**
 * RAW Plaid API Response Format
 * This represents data AS IT COMES FROM PLAID (nested amounts).
 *
 * ⚠️ WARNING: Do NOT use this structure for Firestore documents!
 * Transform this to RecurringOutflow/RecurringIncome before saving to Firestore.
 */
export interface PlaidRecurringTransactionStreamResponse {
  streamId: string;
  status: PlaidRecurringTransactionStatus;
  streamType: PlaidRecurringTransactionStreamType;
  description: string;
  merchantName?: string;
  category: string[];
  averageAmount: PlaidRecurringAmount; // ❌ NESTED - Transform to flat number before saving!
  lastAmount: PlaidRecurringAmount;    // ❌ NESTED - Transform to flat number before saving!
  frequency: PlaidRecurringFrequency;
  firstDate: string; // ISO date string
  lastDate: string; // ISO date string
  transactionCount: number;
}

// =======================
// OUTFLOW PERIODS TYPES
// =======================

// Outflow Period Status enum
export enum OutflowPeriodStatus {
  PENDING = 'pending',           // Not yet due, no payments
  DUE_SOON = 'due_soon',        // Due within 3 days
  PARTIAL = 'partial',           // Partially paid
  PAID = 'paid',                 // Fully paid
  PAID_EARLY = 'paid_early',    // Paid before due date
  OVERDUE = 'overdue'           // Past due, unpaid
}

// =======================
// OUTFLOW TYPES (FLAT STRUCTURE)
// =======================

/**
 * Outflow (Recurring Expense Stream) - FLAT STRUCTURE
 *
 * Represents a recurring expense detected by Plaid or manually created by users.
 * This is the NEW flat structure - all fields at root level for efficient queries.
 *
 * Document ID: Plaid stream_id (for Plaid-sourced) or auto-generated (for manual)
 */
export interface Outflow extends BaseDocument {
  // === DOCUMENT IDENTITY ===
  id: string;                          // Plaid stream_id (also Firestore document ID)
  createdAt: Timestamp;                // Document creation timestamp (inherited from BaseDocument)
  updatedAt: Timestamp;                // Document update timestamp (inherited from BaseDocument)

  // === OWNERSHIP & ACCESS (Query-Critical) ===
  ownerId: string;                     // userId of creator (renamed from userId for consistency with transactions)
  createdBy: string;                   // userId of creator (audit trail)
  updatedBy: string;                   // userId of last updater (audit trail)
  groupId: string | null;              // Family/group association (null = private)

  // === PLAID IDENTIFIERS ===
  plaidItemId: string;                 // Plaid item ID reference
  accountId: string;                   // Plaid account ID reference

  // === FINANCIAL DATA ===
  lastAmount: number;                  // Last amount paid (from Plaid, absolute value)
  averageAmount: number;               // Average amount (from Plaid, absolute value)
  currency: string;                    // ISO currency code (e.g., "USD")

  // === DESCRIPTIVE INFO ===
  description: string | null;          // Description from Plaid (or user-entered)
  merchantName: string | null;         // Merchant name from Plaid
  userCustomName: string | null;       // User-defined custom display name override

  // === TEMPORAL DATA ===
  frequency: string;                   // From Plaid: WEEKLY, MONTHLY, ANNUALLY, etc.
  firstDate: Timestamp;                // First occurrence date (from Plaid)
  lastDate: Timestamp;                 // Last occurrence date (from Plaid)
  predictedNextDate: Timestamp | null; // Predicted next occurrence (from Plaid)

  // === CATEGORIZATION ===
  plaidPrimaryCategory: string;        // Plaid primary category (e.g., "FOOD_AND_DRINK")
  plaidDetailedCategory: string;       // Plaid detailed category (e.g., "FOOD_AND_DRINK_RESTAURANTS")
  internalPrimaryCategory: string | null;   // User override primary category
  internalDetailedCategory: string | null;  // User override detailed category
  type: string;                        // Transaction type from Plaid (e.g., "special", "unresolved")

  // === LEGACY FIELDS (maintained for backward compatibility) ===
  expenseType: string;                 // LEGACY: 'subscription' | 'utility' | 'loan' | 'rent' | 'insurance' | 'tax' | 'other'
  isEssential: boolean;                // LEGACY: Essential expense flag (derived from categories)

  // === STATUS & CONTROL ===
  source: string;                      // 'plaid' (from Plaid) or 'user' (manually created)
  isActive: boolean;                   // Active status (from Plaid or user-controlled)
  isHidden: boolean;                   // User visibility control (false = visible)
  isUserModified: boolean;             // Has been modified by user (from Plaid field)
  plaidStatus: string;                 // Status from Plaid (e.g., "ACTIVE", "INACTIVE")

  // === TRANSACTION REFERENCES ===
  transactionIds: string[];            // Array of Plaid transaction IDs that compose this stream

  // === USER INTERACTION ===
  tags: string[];                      // User-defined tags for organization
  rules: any[];                        // User-defined or system rules (empty array for future use)
}

// Transaction Split Reference - Links outflow periods to transaction splits for payment tracking
export interface TransactionSplitReference {
  transactionId: string; // Reference to transactions collection (Plaid transaction ID, now used as document ID)
  splitId: string; // Reference to specific split within transaction.splits array
  transactionDate: Timestamp; // Date of the transaction
  amount: number; // Amount of the split payment
  description: string; // Transaction description for reference

  // NEW: Payment tracking and classification
  paymentType: PaymentType; // Payment classification (regular, catch_up, advance, extra_principal)
  isAutoMatched: boolean; // Whether this was automatically matched by the system
  matchedAt: Timestamp; // When the split was matched to this outflow period
  matchedBy: string; // 'system' for auto-match, or userId for manual assignment
}

/**
 * Outflow Occurrence - Individual occurrence within an outflow period
 *
 * Represents a single occurrence of a recurring bill within a period.
 * This replaces the parallel arrays pattern (occurrenceDueDates, occurrencePaidFlags, occurrenceTransactionIds)
 * with a self-contained object pattern similar to TransactionSplit.
 *
 * Benefits:
 * - Self-contained (impossible to desynchronize)
 * - Type-safe
 * - Easy to extend with new metadata
 * - Supports partial payments, notes, and rich payment tracking
 *
 * Example: A weekly $10 bill in a monthly period has 4 OutflowOccurrence objects
 */
export interface OutflowOccurrence {
  id: string;                          // Unique ID: "{periodId}_occ_{index}"
  dueDate: Timestamp;                  // When this occurrence is due
  isPaid: boolean;                     // Payment status
  transactionId: string | null;        // Linked transaction ID (if paid)
  transactionSplitId: string | null;   // Linked transaction split ID (if paid)
  paymentDate: Timestamp | null;       // When payment was made
  amountDue: number;                   // Expected amount for this occurrence
  amountPaid: number;                  // Actual amount paid (0 if unpaid)
  paymentType: 'regular' | 'catch_up' | 'advance' | 'extra_principal' | null; // Payment classification
  isAutoMatched: boolean;              // Was this automatically matched by system?
  matchedAt: Timestamp | null;         // When the payment was matched
  matchedBy: string | null;            // Who matched it ('system' or userId)
  notes?: string;                      // Optional user notes for this occurrence
  tags?: string[];                     // Optional tags for this occurrence
}

/**
 * Outflow Period - FLAT STRUCTURE (Fully Aligned with Firestore Schema)
 *
 * Represents an outflow occurrence within a specific period.
 * Supports multiple occurrences (e.g., weekly bill occurring 4x in monthly period).
 *
 * All fields are at the root level for simplified security rules and efficient queries.
 *
 * Migration Strategy: Fresh start only - new outflow_periods use flat structure,
 * existing outflow_periods with nested structure remain unchanged.
 */
export interface OutflowPeriod extends BaseDocument {
  // === IDENTITY ===
  id: string;                              // Format: {outflowId}_{sourcePeriodId}
  outflowId: string;                       // Reference to parent outflow
  sourcePeriodId: string;                  // Reference to source_periods collection

  // === OWNERSHIP & ACCESS (Query-Critical) ===
  ownerId: string;                         // User ID of owner
  createdBy: string;                       // User ID of creator
  updatedBy: string;                       // User ID of last updater
  groupId: string | null;                  // Family/group association

  // === PLAID IDENTIFIERS ===
  accountId: string;                       // Plaid account ID (comes from plaid)
  plaidItemId: string;                     // Plaid item ID

  // === FINANCIAL TRACKING ===
  actualAmount: number | null;             // Actual amount charged (null until transaction attached)
  amountWithheld: number;                  // Amount to withhold for this period (expectedAmount / days in period)
  averageAmount: number;                   // Average amount received from Plaid
  expectedAmount: number;                  // Total expected amount for period (same as totalAmountDue)
  amountPerOccurrence: number;             // Single bill amount (e.g., $10 weekly)
  totalAmountDue: number;                  // Total for period (occurrences × amount)
  totalAmountPaid: number;                 // Sum of paid occurrences
  totalAmountUnpaid: number;               // Calculated: due - paid

  // === TIMESTAMPS ===
  createdAt: Timestamp;                    // When document was created
  updatedAt: Timestamp;                    // Last update timestamp
  lastCalculated: Timestamp;               // Last calculation timestamp

  // === PAYMENT CYCLE INFO ===
  currency: string;                        // ISO currency code (comes from plaid)
  cycleDays: number;                       // Number of days between payments
  cycleStartDate: Timestamp;               // Current cycle start
  cycleEndDate: Timestamp;                 // Current cycle end
  dailyWithholdingRate: number;            // Daily withholding rate

  // === OUTFLOW METADATA (Denormalized) ===
  description: string;                     // Bill description
  frequency: string;                       // "WEEKLY" | "BIWEEKLY" | "MONTHLY" | etc.

  // === PAYMENT STATUS ===
  status?: OutflowPeriodStatus;            // Current payment status (calculated from transactionSplits)
  isPaid: boolean;                         // Legacy: same as isFullyPaid
  isFullyPaid: boolean;                    // All occurrences paid
  isPartiallyPaid: boolean;                // Some but not all paid
  isDuePeriod: boolean;                    // True if ANY occurrence due this period

  // === CATEGORIZATION (Flat Fields) ===
  internalDetailedCategory: string | null; // User override detailed category
  internalPrimaryCategory: string | null;  // User override primary category
  plaidPrimaryCategory: string;            // Plaid primary category
  plaidDetailedCategory: string;           // Plaid detailed category

  // === STATUS & CONTROL ===
  isActive: boolean;                       // Active status
  isHidden: boolean;                       // User visibility control

  // === MERCHANT INFO ===
  merchant: string | null;                 // Merchant/payee name
  payee: string | null;                    // Payee (alias for merchant)

  // === PERIOD CONTEXT ===
  periodStartDate: Timestamp;              // Period start (UTC)
  periodEndDate: Timestamp;                // Period end (UTC)
  periodType: PeriodType;                  // "weekly" | "monthly" | "bi_monthly"

  // === PLAID PREDICTION ===
  predictedNextDate: Timestamp | null;     // Plaid's predicted next date

  // === USER INTERACTION ===
  rules: any[];                            // User or system rules
  tags: string[];                          // User-defined tags
  type: string;                            // Outflow type/classification
  note: string | null;                     // User notes for this period
  userCustomName: string | null;           // User's custom name override

  // === SOURCE ===
  source: string;                          // "plaid" or "user"

  // === TRANSACTION TRACKING ===
  transactionIds: string[];                // All matched transaction IDs (flat array)
  transactionSplits?: TransactionSplitReference[]; // Array of payment splits assigned to this period

  // === NEW: OCCURRENCE OBJECT ARRAY (Replaces parallel arrays) ===
  occurrences?: OutflowOccurrence[];       // Array of occurrence objects with payment metadata

  // === MULTI-OCCURRENCE TRACKING (Additional Fields for Multi-Occurrence System) ===
  numberOfOccurrencesInPeriod: number;     // How many times bill occurs in this period
  numberOfOccurrencesPaid: number;         // How many occurrences have been paid
  numberOfOccurrencesUnpaid: number;       // Calculated: total - paid

  /** @deprecated Use occurrences array instead */
  occurrenceDueDates: Timestamp[];         // Array of all due dates in period
  /** @deprecated Use occurrences array instead */
  occurrencePaidFlags: boolean[];          // Parallel array: which occurrences paid
  /** @deprecated Use occurrences array instead */
  occurrenceTransactionIds: (string | null)[]; // Parallel array: transaction IDs

  // === PROGRESS METRICS (Additional Fields) ===
  paymentProgressPercentage: number;       // (paid / total) × 100 (unit %)
  dollarProgressPercentage: number;        // ($ paid / $ due) × 100

  // === DUE DATE TRACKING (Additional Fields) ===
  dueDate?: Timestamp;                     // Primary due date for this period (if isDuePeriod)
  expectedDueDate?: Timestamp;             // Expected/predicted due date for planning
  amountDue?: number;                      // Amount due in this period (0 if not due period)
  firstDueDateInPeriod: Timestamp | null;  // First due date in period
  lastDueDateInPeriod: Timestamp | null;   // Last due date in period
  nextUnpaidDueDate: Timestamp | null;     // Next unpaid due date
}

// =======================
// PERIOD MANAGEMENT TYPES
// =======================

// Period range definition for batch operations
export interface PeriodRange {
  startPeriodId: string;
  endPeriodId: string;
  periodType: PeriodType;
  count: number;
}

// Configuration for period management strategies
export interface PeriodManagementConfig {
  defaultWindowSize: number;
  edgeDetectionThreshold: number;
  maxPreloadExpansion: number;
  batchExtensionSize: number;
  maxBatchExtensionLimit: number;
  preloadStrategy: 'conservative' | 'balanced' | 'aggressive';
}

// =======================
// INFLOW TYPES
// =======================

/**
 * Inflow (Recurring Income Stream) - FLAT STRUCTURE
 *
 * Represents a recurring income detected by Plaid or manually created by users.
 * This is the NEW flat structure - all fields at root level for efficient queries.
 *
 * Migration Strategy: Fresh start only - new inflows use flat structure,
 * existing inflows with nested structure remain unchanged.
 */
export interface Inflow extends BaseDocument {
  // === DOCUMENT IDENTITY ===
  id: string;                          // Plaid stream_id (also Firestore document ID)

  // === OWNERSHIP & ACCESS (Query-Critical) ===
  ownerId: string;                     // userId of creator
  createdBy: string;                   // userId of creator
  updatedBy: string;                   // userId of last updater
  groupId: string | null;              // Family/group association

  // === PLAID IDENTIFIERS ===
  plaidItemId: string;                 // Plaid item ID
  accountId: string;                   // Plaid account ID

  // === FINANCIAL DATA ===
  lastAmount: number;                  // Last amount received
  averageAmount: number;               // Average amount
  currency: string;                    // ISO currency code
  unofficialCurrency: string | null;   // Unofficial currency code (if any)

  // === DESCRIPTIVE INFO ===
  description: string | null;          // Description from Plaid
  merchantName: string | null;         // Payer name from Plaid
  userCustomName: string | null;       // User custom name override

  // === TEMPORAL DATA ===
  frequency: string;                   // WEEKLY, BI_WEEKLY, MONTHLY, etc.
  firstDate: Timestamp;                // First occurrence
  lastDate: Timestamp;                 // Last occurrence
  predictedNextDate: Timestamp | null; // Predicted next

  // === CATEGORIZATION ===
  plaidPrimaryCategory: string;        // Plaid primary category
  plaidDetailedCategory: string;       // Plaid detailed category
  plaidCategoryId: string | null;      // Plaid category ID
  internalPrimaryCategory: string | null;   // User override primary
  internalDetailedCategory: string | null;  // User override detailed

  // === INCOME CLASSIFICATION ===
  incomeType: string;                  // 'salary', 'wage', 'investment', 'other'
  isRegularSalary: boolean;            // Whether this is regular salary/wage

  // === STATUS & CONTROL ===
  source: string;                      // 'plaid' or 'user'
  isActive: boolean;                   // Active status
  isHidden: boolean;                   // User visibility control
  isUserModified: boolean;             // Modified by user
  plaidStatus: string;                 // Status from Plaid
  plaidConfidenceLevel: string | null; // Plaid confidence level

  // === TRANSACTION REFERENCES ===
  transactionIds: string[];            // Array of transaction IDs

  // === USER INTERACTION ===
  tags: string[];                      // User-defined tags
  rules: any[];                        // User or system rules

  // === AUDIT TRAIL ===
  lastSyncedAt: Timestamp;             // Last sync time with Plaid
}

// =======================
// INFLOW PERIODS TYPES
// =======================

// Inflow Periods - Maps inflows to source periods with earning calculations
// NOTE: Inflow periods INHERIT ownership from parent inflow (no separate ownership)
/**
 * Inflow Period - FLAT STRUCTURE (Aligned with OutflowPeriod Schema)
 *
 * Represents an income stream occurrence within a specific period.
 * Supports multiple occurrences (e.g., weekly income occurring 4x in monthly period).
 *
 * All fields are at the root level for simplified security rules and efficient queries.
 */
export interface InflowPeriod extends BaseDocument {
  // === IDENTITY ===
  id: string;
  inflowId: string;
  sourcePeriodId: string;

  // === OWNERSHIP & ACCESS (Query-Critical) ===
  ownerId: string;
  createdBy: string;
  updatedBy: string;
  groupId: string | null;

  // === PLAID IDENTIFIERS ===
  accountId: string;                          // Plaid account ID (comes from plaid)
  plaidItemId: string;                        // Plaid item ID

  // === FINANCIAL TRACKING ===
  actualAmount: number | null;                // Actual amount received (null until transaction attached)
  amountWithheld: number;                     // Amount to withhold for this period
  averageAmount: number;                      // Average amount received from Plaid
  expectedAmount: number;                     // Total expected amount for period
  amountPerOccurrence: number;                // Single income amount (e.g., $500 bi-weekly)
  totalAmountDue: number;                     // Total for period (occurrences × amount)
  totalAmountPaid: number;                    // Sum of received occurrences
  totalAmountUnpaid: number;                  // Calculated: due - received

  // === TIMESTAMPS ===
  createdAt: Timestamp;                       // When document was created
  updatedAt: Timestamp;                       // Last update timestamp
  lastCalculated: Timestamp;                  // Last calculation timestamp

  // === PAYMENT CYCLE INFO ===
  currency: string;                           // ISO currency code (comes from plaid)
  cycleDays: number;                          // Number of days between payments
  cycleStartDate: Timestamp;                  // Current cycle start
  cycleEndDate: Timestamp;                    // Current cycle end
  dailyWithholdingRate: number;               // Daily withholding rate

  // === INFLOW METADATA (Denormalized) ===
  description: string;                        // Income description
  frequency: string;                          // "WEEKLY" | "BIWEEKLY" | "MONTHLY" | etc.

  // === PAYMENT STATUS ===
  isPaid: boolean;                            // Legacy: same as isFullyPaid
  isFullyPaid: boolean;                       // All occurrences received
  isPartiallyPaid: boolean;                   // Some but not all received
  isReceiptPeriod: boolean;                   // True if ANY occurrence due this period

  // === CATEGORIZATION (Flat Fields) ===
  internalDetailedCategory: string | null;    // User override detailed category
  internalPrimaryCategory: string | null;     // User override primary category
  plaidPrimaryCategory: string;               // Plaid primary category
  plaidDetailedCategory: string;              // Plaid detailed category

  // === STATUS & CONTROL ===
  isActive: boolean;                          // Active status
  isHidden: boolean;                          // User visibility control

  // === MERCHANT INFO ===
  merchant: string | null;                    // Merchant/payer name
  payee: string | null;                       // Payer (alias for merchant)

  // === PERIOD CONTEXT ===
  periodStartDate: Timestamp;                 // Period start (UTC)
  periodEndDate: Timestamp;                   // Period end (UTC)
  periodType: PeriodType;                     // "weekly" | "monthly" | "bi_monthly"

  // === PLAID PREDICTION ===
  predictedNextDate: Timestamp | null;        // Plaid's predicted next date

  // === USER INTERACTION ===
  rules: any[];                               // User or system rules
  tags: string[];                             // User-defined tags
  type: string;                               // Inflow type/classification
  note: string | null;                        // User notes for this period
  userCustomName: string | null;              // User's custom name override

  // === SOURCE ===
  source: string;                             // "plaid" or "user"

  // === TRANSACTION TRACKING ===
  transactionIds: string[];                   // All matched transaction IDs (flat array)

  // === MULTI-OCCURRENCE TRACKING ===
  numberOfOccurrencesInPeriod: number;        // How many times income occurs in this period
  numberOfOccurrencesPaid: number;            // How many occurrences have been received
  numberOfOccurrencesUnpaid: number;          // Calculated: total - received
  occurrenceDueDates: Timestamp[];            // Array of all expected dates in period
  occurrencePaidFlags: boolean[];             // Parallel array: which occurrences received
  occurrenceTransactionIds: (string | null)[]; // Parallel array: transaction IDs

  // === PROGRESS METRICS ===
  paymentProgressPercentage: number;          // (received / total) × 100 (unit %)
  dollarProgressPercentage: number;           // ($ received / $ due) × 100

  // === DUE DATE TRACKING ===
  firstDueDateInPeriod: Timestamp | null;     // First expected date in period
  lastDueDateInPeriod: Timestamp | null;      // Last expected date in period
  nextUnpaidDueDate: Timestamp | null;        // Next unreceived date
}

// =======================
// PERIOD MANAGEMENT TYPES
// =======================

// Period range definition for batch operations
export interface PeriodRange {
  startPeriodId: string;
  endPeriodId: string;
  periodType: PeriodType;
  count: number;
}

// Configuration for period management strategies
export interface PeriodManagementConfig {
  defaultWindowSize: number;
  edgeDetectionThreshold: number;
  maxPreloadExpansion: number;
  batchExtensionSize: number;
  maxBatchExtensionLimit: number;
  preloadStrategy: 'conservative' | 'balanced' | 'aggressive';
}