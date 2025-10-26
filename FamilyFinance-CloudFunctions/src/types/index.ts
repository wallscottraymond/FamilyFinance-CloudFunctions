import { Timestamp } from "firebase-admin/firestore";
import { SystemRole } from "./users";
import { GroupMembership } from "./groups";
import { ResourceSharing } from "./sharing";

// Export new modular types
export * from "./users";
export * from "./groups";
export * from "./sharing";

// Base interface for all documents
export interface BaseDocument {
  id?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
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
export interface TransactionSplit {
  id: string;                     // Unique identifier for the split
  budgetId: string;               // Reference to budgets collection (empty string if assigned to outflow)
  budgetName: string;             // Denormalized budget name for display performance (empty string if assigned to outflow)

  // NEW: Outflow assignment (mutually exclusive with budget assignment)
  outflowPeriodId?: string;       // Reference to outflow_periods collection
  outflowId?: string;             // Reference to outflows collection (for quick lookup)
  outflowDescription?: string;    // Denormalized outflow description for display

  // NEW: Period-type-specific outflow assignments (for multi-period payment tracking)
  outflowMonthlyPeriodId?: string;   // Reference to monthly outflow_period
  outflowWeeklyPeriodId?: string;    // Reference to weekly outflow_period
  outflowBiWeeklyPeriodId?: string;  // Reference to bi-weekly outflow_period

  // NEW: Bill assignment fields
  billId?: string;                // Reference to outflows/bills collection
  billName?: string;              // Denormalized bill name for display

  // Category information
  categoryId: string;             // Category ID from categories collection (matched by detailed_plaid_category)
  category?: string;              // Plaid detailed category (e.g., "FOOD_AND_DRINK_RESTAURANTS")
  categoryPrimary?: string;       // Plaid primary category (e.g., "FOOD_AND_DRINK")

  amount: number;                 // Amount allocated to this split
  description?: string;           // Optional override description for this split
  isDefault: boolean;             // True for the auto-created split when transaction is created

  // Enhanced status fields for budget tracking
  isIgnored?: boolean;            // User marked to ignore from budget tracking
  isRefund?: boolean;             // Transaction is a refund (subtract from spending)
  isTaxDeductible?: boolean;      // Tax-deductible expense
  ignoredReason?: string;         // Why user ignored this split
  refundReason?: string;          // Reason for refund classification
  taxDeductibleCategory?: string; // Tax category for deductible items

  // NEW: Simple status flags
  ignore?: boolean;               // Simple ignore flag for user convenience
  return?: boolean;               // Transaction is a return/refund (simplified from isRefund)
  deductible?: boolean;           // Tax deductible (simplified from isTaxDeductible)
  note?: string;                  // User note for this split

  // Enhanced assignment metadata
  excludedFromBudgets?: string[]; // Budget IDs to exclude this split from
  manualBudgetAssignment?: boolean; // User manually assigned vs auto-assigned

  // NEW: Payment type tracking for outflow assignments
  paymentType?: PaymentType;      // Payment classification (regular, catch_up, advance, extra_principal)
  paymentDate?: Timestamp;        // Date when payment was made (matches transaction.date)

  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;              // User who created this split
}

export interface Transaction extends BaseDocument {
  userId: string;
  familyId: string;
  accountId?: string;             // Plaid account ID for filtering transactions by account
  amount: number;
  currency: string;
  description: string;
  category: string;               // Category ID from categories collection (matched by detailed_plaid_category)
  type: TransactionType;
  date: Timestamp;
  location?: TransactionLocation;
  receiptUrl?: string;
  tags: string[];
  budgetId?: string;              // Legacy field - maintained for backward compatibility
  recurringTransactionId?: string;
  status: TransactionStatus;
  approvedBy?: string;
  approvedAt?: Timestamp;
  metadata: Record<string, any>;
  
  // New splitting functionality
  splits: TransactionSplit[];     // Array of transaction splits
  isSplit: boolean;               // True if transaction has multiple splits or user has modified splits
  totalAllocated: number;         // Sum of all split amounts
  unallocated: number;            // amount - totalAllocated (remaining unallocated amount)
  affectedBudgetPeriods: string[]; // Array of budget period IDs for efficient querying
  affectedBudgets: string[];      // Array of budget IDs for flexibility
  primaryBudgetId?: string;       // The budget with the largest split amount (for default sorting)
  primaryBudgetPeriodId?: string; // The budget period with the largest split amount

  // Enhanced filtering fields for quick queries
  hasIgnoredSplits?: boolean;     // Quick flag for filtering ignored transactions
  hasRefundSplits?: boolean;      // Quick flag for refund transactions
  hasTaxDeductibleSplits?: boolean; // Quick flag for tax tracking

  // NEW: Rules system - Original immutable Plaid data (for rule recalculation)
  plaidData?: {
    category: string;              // Original Plaid category array joined
    detailedCategory?: string;     // Original detailed category
    primaryCategory?: string;      // Original primary category
    merchantName?: string;         // Original merchant name
    amount: number;                // Original amount
    date: Timestamp;               // Original transaction date
    description: string;           // Original description/name
    pending: boolean;              // Original pending status

    // Store full personal_finance_category for reference
    personalFinanceCategory?: {
      primary: string;
      detailed: string;
      confidenceLevel?: string;
    };
  };

  // NEW: Rule application tracking
  appliedRules?: string[];          // Array of rule IDs currently applied
  isRuleModified?: boolean;         // Has any rule modified this transaction?
  lastRuleApplication?: Timestamp;  // When rules were last applied
  ruleApplicationCount?: number;    // Number of times rules have been applied
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
export interface Budget extends BaseDocument {
  name: string;
  description?: string;

  // RBAC fields (NEW - optional during migration)
  ownerId?: string;               // Current owner (NEW)
  sharing?: ResourceSharing;      // Sharing configuration (NEW)

  // Legacy fields (DEPRECATED but kept for backward compatibility)
  familyId?: string;              // DEPRECATED - use sharing.sharedWith instead
  createdBy: string;              // Always set to the user who created the budget
  memberIds: string[];            // DEPRECATED - use sharing.sharedWith instead
  isShared: boolean;              // DEPRECATED - use sharing.isShared instead

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
}

export interface UpdateTransactionRequest {
  amount?: number;
  description?: string;
  category?: string;             // Category ID from categories collection
  location?: TransactionLocation;
  tags?: string[];
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
  memberIds?: string[]; // Optional - for shared budgets only
  isShared?: boolean; // Optional - defaults to false (individual budget)
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
export interface BudgetPeriodDocument extends BaseDocument {
  budgetId: string;           // Reference to budgets collection
  budgetName: string;         // Denormalized budget name for performance
  periodId: string;           // Reference to source_periods.id (same as sourcePeriodId)
  sourcePeriodId: string;     // Direct reference to source_periods.id for mapping
  familyId?: string;          // Optional - same as budget familyId for easy querying
  
  // Ownership and permissions
  userId: string;             // Same as budget.createdBy for security rules
  createdBy: string;          // Original budget creator (explicit tracking)
  
  // Period context (denormalized from source_periods for performance)
  periodType: PeriodType;     // "weekly" | "monthly" | "bi_monthly"
  periodStart: Timestamp;     // UTC timestamp
  periodEnd: Timestamp;       // UTC timestamp
  
  // Budget amounts
  allocatedAmount: number;    // Proportionally calculated amount for this period
  originalAmount: number;     // Store original calculation for reference
  
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
  accountId: string; // Plaid account_id
  itemId: string; // Reference to plaid_items document
  userId: string; // Family Finance user ID  
  familyId?: string; // Optional family association
  persistentAccountId?: string; // Plaid persistent_account_id for tracking across reconnections
  name: string; // Account name from institution
  mask?: string; // Account number mask (e.g., "0000")
  officialName?: string; // Official account name from institution
  type: PlaidAccountType;
  subtype: PlaidAccountSubtype;
  balances: PlaidAccountBalances;
  verificationStatus?: PlaidVerificationStatus;
  isActive: boolean; // Whether this account should be included in transactions
  isSyncEnabled: boolean; // Whether to sync transactions for this account
  lastSyncedAt?: Timestamp; // Last time transactions were synced
  metadata: {
    institution: {
      name: string;
      logo?: string;
    };
    linkedAt: Timestamp; // When account was first linked
    lastBalanceUpdate: Timestamp; // Last time balance was updated
  };
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
export interface BaseRecurringTransaction extends BaseDocument {
  streamId: string; // Plaid recurring stream ID
  itemId: string; // Reference to plaid_items document
  userId: string; // Family Finance user ID
  familyId?: string; // Optional family association
  accountId: string; // Primary account where this recurring stream appears
  
  // Stream classification
  isActive: boolean; // Whether this stream is still active
  status: PlaidRecurringTransactionStatus; // Current status of the stream
  
  // Transaction details
  description: string; // Recurring transaction description
  merchantName?: string; // Merchant name if available
  category: string[]; // Plaid category hierarchy
  personalFinanceCategory?: PlaidPersonalFinanceCategory; // Enhanced categorization
  
  // Amount information
  averageAmount: PlaidRecurringAmount; // Average amount data
  lastAmount: PlaidRecurringAmount; // Most recent amount data
  
  // Frequency and timing
  frequency: PlaidRecurringFrequency; // How often this recurs

  // Historical data
  firstDate: Timestamp; // Date of first transaction in stream
  lastDate: Timestamp; // Date of last transaction in stream
  predictedNextDate?: Timestamp; // Plaid's ML prediction of next occurrence
  transactionIds: string[]; // IDs of transactions that are part of this stream

  // Stream modification tracking
  isUserModified?: boolean; // Whether user has manually modified this stream
  
  // Family Finance specific fields
  userCategory?: TransactionCategory; // User-assigned category override
  userNotes?: string; // User-added notes
  tags: string[]; // User-added tags
  isHidden: boolean; // Whether user has hidden this recurring transaction
  
  // Sync metadata
  lastSyncedAt: Timestamp; // When this recurring transaction was last synced from Plaid
  syncVersion: number; // Version for optimistic concurrency control
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

export interface PlaidRecurringTransactionStreamResponse {
  streamId: string;
  status: PlaidRecurringTransactionStatus;
  streamType: PlaidRecurringTransactionStreamType;
  description: string;
  merchantName?: string;
  category: string[];
  averageAmount: PlaidRecurringAmount;
  lastAmount: PlaidRecurringAmount;
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

// Outflow Periods - Maps outflows to source periods with withholding calculations
export interface OutflowPeriod extends BaseDocument {
  outflowId: string; // Reference to outflows collection document
  periodId: string; // Reference to source_periods.id (same as sourcePeriodId)
  sourcePeriodId: string; // Direct reference to source_periods.id for mapping
  userId: string; // Family Finance user ID
  familyId?: string; // Optional family association

  // Period context (denormalized from source_periods for performance)
  periodType: PeriodType; // "weekly" | "monthly" | "bi_monthly"
  periodStartDate: Timestamp; // UTC timestamp - period start
  periodEndDate: Timestamp; // UTC timestamp - period end

  // Payment cycle information
  cycleStartDate: Timestamp; // Last payment date (or calculated start)
  cycleEndDate: Timestamp; // Next payment date
  cycleDays: number; // Days in the payment cycle

  // Financial calculations
  billAmount: number; // Full bill amount for this cycle
  dailyWithholdingRate: number; // billAmount ÷ cycleDays
  amountWithheld: number; // dailyRate × daysInPeriod (how much to withhold this period)
  amountDue: number; // billAmount if due date falls in this period, else 0

  // Payment status and tracking
  isDuePeriod: boolean; // True if the due date falls within this period
  dueDate?: Timestamp; // Actual due date if isDuePeriod is true
  expectedDueDate: Timestamp; // Next expected due date relative to this period (may be in future)
  expectedDrawDate: Timestamp; // Expected draw date (adjusts for weekends - Saturday/Sunday → Monday)
  status: string; // Payment status (e.g., "pending", "paid", "overdue")
  isActive: boolean; // Whether this outflow period is active
  transactionSplits: TransactionSplitReference[]; // Array of transaction splits that have been applied to this bill payment

  // Metadata from outflow (denormalized for performance)
  outflowDescription: string; // Description from outflow
  outflowMerchantName?: string; // Merchant name from outflow
  outflowExpenseType?: string; // Expense type from outflow
  outflowIsEssential?: boolean; // Whether this is an essential expense

  // System tracking
  lastCalculated: Timestamp; // When amounts were last calculated
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
// INFLOW PERIODS TYPES
// =======================

// Inflow Periods - Maps inflows to source periods with earning calculations
export interface InflowPeriod extends BaseDocument {
  inflowId: string; // Reference to inflows collection document
  periodId: string; // Reference to source_periods.id (same as sourcePeriodId)  
  sourcePeriodId: string; // Direct reference to source_periods.id for mapping
  userId: string; // Family Finance user ID
  familyId?: string; // Optional family association
  
  // Period context (denormalized from source_periods for performance)
  periodType: PeriodType; // "weekly" | "monthly" | "bi_monthly"
  periodStartDate: Timestamp; // UTC timestamp - period start
  periodEndDate: Timestamp; // UTC timestamp - period end
  
  // Payment cycle information
  cycleStartDate: Timestamp; // Last payment date (or calculated start)
  cycleEndDate: Timestamp; // Next payment date
  cycleDays: number; // Days in the payment cycle
  
  // Financial calculations
  incomeAmount: number; // Full income amount for this cycle
  dailyEarningRate: number; // incomeAmount ÷ cycleDays
  amountEarned: number; // dailyRate × daysInPeriod (how much earned this period)
  amountReceived: number; // incomeAmount if receipt date falls in this period, else 0
  
  // Payment status and tracking
  isReceiptPeriod: boolean; // True if the receipt date falls within this period
  receiptDate?: Timestamp; // Actual receipt date if isReceiptPeriod is true
  isActive: boolean; // Whether this inflow period is active
  
  // Metadata from inflow (denormalized for performance)
  inflowDescription: string; // Description from inflow
  inflowMerchantName?: string; // Merchant name from inflow
  inflowIncomeType?: string; // Income type from inflow
  inflowIsRegularSalary?: boolean; // Whether this is regular salary income
  
  // System tracking
  lastCalculated: Timestamp; // When amounts were last calculated
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