import { Timestamp } from "firebase-admin/firestore";
import { SystemRole } from "./users";
import { GroupMembership } from "./groups";
export * from "./users";
export * from "./groups";
export * from "./sharing";
export * from "./outflowSummaries";
export interface BaseDocument {
    id?: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
/**
 * Access Control Object
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
export interface User extends BaseDocument {
    email: string;
    displayName: string;
    photoURL?: string;
    systemRole?: SystemRole;
    groupMemberships?: GroupMembership[];
    demoAccountId?: string;
    familyId?: string;
    role: UserRole;
    preferences: UserPreferences;
    isActive: boolean;
}
export declare enum UserRole {
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
    dataRetentionPeriod: number;
    allowAnalytics: boolean;
    allowMarketingEmails: boolean;
}
export interface DisplaySettings {
    dateFormat: "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD";
    timeFormat: "12h" | "24h";
    numberFormat: "US" | "EU" | "IN";
    showCentsInDisplays: boolean;
    defaultTransactionView: "list" | "cards" | "table";
    chartPreferences: ChartPreferences;
    dashboardLayout: string[];
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
    longPressDelay: number;
}
export interface FinancialSettings {
    defaultTransactionCategory: TransactionCategory;
    autoCategorizationEnabled: boolean;
    roundUpSavings: boolean;
    roundUpSavingsGoalId?: string;
    budgetStartDay: number;
    showNetWorth: boolean;
    hiddenAccounts: string[];
    defaultBudgetAlertThreshold: number;
    enableSpendingLimits: boolean;
    dailySpendingLimit?: number;
    weeklySpendingLimit?: number;
    monthlySpendingLimit?: number;
}
export interface SecuritySettings {
    biometricAuthEnabled: boolean;
    pinAuthEnabled: boolean;
    autoLockTimeout: number;
    requireAuthForTransactions: boolean;
    requireAuthForBudgetChanges: boolean;
    requireAuthForGoalChanges: boolean;
    sessionTimeout: number;
    allowedDevices: string[];
    twoFactorAuthEnabled: boolean;
    backupPhoneNumber?: string;
    lastPasswordChange?: string;
    suspiciousActivityDetection: boolean;
}
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
export declare enum PaymentType {
    REGULAR = "regular",// Normal payment for the period
    CATCH_UP = "catch_up",// Payment covering past-due periods
    ADVANCE = "advance",// Payment for future periods
    EXTRA_PRINCIPAL = "extra_principal"
}
export interface TransactionSplit {
    splitId: string;
    budgetId: string;
    monthlyPeriodId: string | null;
    weeklyPeriodId: string | null;
    biWeeklyPeriodId: string | null;
    outflowId?: string | null;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    internalPrimaryCategory: string | null;
    internalDetailedCategory: string | null;
    amount: number;
    description?: string | null;
    isDefault: boolean;
    isIgnored?: boolean;
    isRefund?: boolean;
    isTaxDeductible?: boolean;
    ignoredReason?: string | null;
    refundReason?: string | null;
    paymentType?: PaymentType;
    paymentDate: Timestamp;
    rules: string[];
    tags: string[];
    createdAt: Timestamp;
    updatedAt: Timestamp;
}
export interface Transaction extends BaseDocument {
    id: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    transactionId: string;
    ownerId: string;
    groupId: string | null;
    transactionDate: Timestamp;
    accountId: string;
    createdBy: string;
    updatedBy: string;
    currency: string;
    description: string;
    internalDetailedCategory: string | null;
    internalPrimaryCategory: string | null;
    plaidDetailedCategory: string;
    plaidPrimaryCategory: string;
    plaidItemId: string;
    source: 'plaid' | 'manual' | 'import';
    transactionStatus: TransactionStatus;
    type: TransactionType | null;
    name: string;
    merchantName: string | null;
    splits: TransactionSplit[];
    initialPlaidData: {
        plaidAccountId: string;
        plaidMerchantName: string;
        plaidName: string;
        plaidTransactionId: string;
        plaidPending: boolean;
        source: 'plaid';
    };
}
export declare enum TransactionType {
    INCOME = "income",
    EXPENSE = "expense",
    TRANSFER = "transfer"
}
export declare enum TransactionStatus {
    PENDING = "pending",
    APPROVED = "approved",
    REJECTED = "rejected",
    CANCELLED = "cancelled"
}
export declare enum TransactionCategory {
    SALARY = "salary",
    ALLOWANCE = "allowance",
    INVESTMENT = "investment",
    GIFT = "gift",
    OTHER_INCOME = "other_income",
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
    isActive: boolean;
    isSystemCategory: boolean;
    createdBy?: string;
    transactionCategoryId?: string;
}
export interface TransactionLocation {
    name?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
}
export interface Budget extends BaseDocument, ResourceOwnership {
    name: string;
    description?: string;
    access: AccessControl;
    categories?: Categories;
    metadata?: Metadata;
    relationships?: Relationships;
    amount: number;
    currency: string;
    categoryIds: string[];
    period: BudgetPeriod;
    startDate: Timestamp;
    endDate: Timestamp;
    spent: number;
    remaining: number;
    alertThreshold: number;
    isActive: boolean;
    budgetType: 'recurring' | 'limited';
    endPeriod?: string;
    totalPeriods?: number;
    selectedStartPeriod?: string;
    activePeriodRange?: {
        startPeriod: string;
        endPeriod: string;
    };
    lastExtended?: Timestamp;
    isOngoing: boolean;
    budgetEndDate?: Timestamp;
    isSystemEverythingElse?: boolean;
}
export declare enum BudgetPeriod {
    WEEKLY = "weekly",
    MONTHLY = "monthly",
    QUARTERLY = "quarterly",
    YEARLY = "yearly",
    CUSTOM = "custom"
}
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
export declare enum RecurrenceFrequency {
    DAILY = "daily",
    WEEKLY = "weekly",
    BIWEEKLY = "biweekly",
    MONTHLY = "monthly",
    QUARTERLY = "quarterly",
    YEARLY = "yearly"
}
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
export declare enum NotificationType {
    TRANSACTION_CREATED = "transaction_created",
    TRANSACTION_APPROVED = "transaction_approved",
    TRANSACTION_REJECTED = "transaction_rejected",
    BUDGET_EXCEEDED = "budget_exceeded",
    BUDGET_WARNING = "budget_warning",
    FAMILY_INVITATION = "family_invitation",
    WEEKLY_REPORT = "weekly_report",
    SYSTEM_ANNOUNCEMENT = "system_announcement"
}
export declare enum NotificationPriority {
    LOW = "low",
    NORMAL = "normal",
    HIGH = "high",
    URGENT = "urgent"
}
export interface CreateTransactionRequest {
    amount: number;
    description: string;
    category: string;
    type: TransactionType;
    date?: string;
    location?: TransactionLocation;
    tags?: string[];
    budgetId?: string;
    groupId?: string;
}
export interface UpdateTransactionRequest {
    amount?: number;
    description?: string;
    category?: string;
    location?: TransactionLocation;
    tags?: string[];
}
export interface AddTransactionSplitRequest {
    transactionId: string;
    budgetId: string;
    amount: number;
    categoryId?: TransactionCategory;
    description?: string;
    isIgnored?: boolean;
    isRefund?: boolean;
    isTaxDeductible?: boolean;
    ignoredReason?: string;
    refundReason?: string;
    taxDeductibleCategory?: string;
    excludedFromBudgets?: string[];
    manualBudgetAssignment?: boolean;
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
    isIgnored?: boolean;
    isRefund?: boolean;
    isTaxDeductible?: boolean;
    ignoredReason?: string;
    refundReason?: string;
    taxDeductibleCategory?: string;
    excludedFromBudgets?: string[];
    manualBudgetAssignment?: boolean;
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
    forceRecalculation?: boolean;
}
export interface BudgetSpendingResponse {
    success: boolean;
    budgetPeriodId: string;
    previousSpentAmount: number;
    newSpentAmount: number;
    affectedTransactions: number;
    calculatedAt: string;
    message?: string;
}
export interface CreateBudgetRequest {
    name: string;
    description?: string;
    amount: number;
    categoryIds: string[];
    period: BudgetPeriod;
    budgetType?: 'recurring' | 'limited';
    startDate: string;
    endDate?: string;
    alertThreshold?: number;
    memberIds?: string[];
    isShared?: boolean;
    groupId?: string;
    selectedStartPeriod?: string;
    isOngoing?: boolean;
    budgetEndDate?: string;
}
export interface CreateFamilyRequest {
    name: string;
    description?: string;
    settings?: Partial<FamilySettings>;
}
export interface JoinFamilyRequest {
    inviteCode: string;
}
export interface ApiError {
    code: string;
    message: string;
    details?: Record<string, any>;
}
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
export interface SourcePeriod extends BaseDocument {
    periodId: string;
    type: PeriodType;
    startDate: Timestamp;
    endDate: Timestamp;
    year: number;
    index: number;
    isCurrent: boolean;
    metadata: {
        month?: number;
        weekNumber?: number;
        biMonthlyHalf?: 1 | 2;
        weekStartDay: 0;
    };
}
export declare enum PeriodType {
    WEEKLY = "weekly",
    MONTHLY = "monthly",
    BI_MONTHLY = "bi_monthly"
}
export interface ChecklistItem {
    id: string;
    name: string;
    transactionSplit: string;
    expectedAmount: number;
    actualAmount: number;
    isChecked: boolean;
}
export interface BudgetPeriodDocument extends BaseDocument, ResourceOwnership {
    budgetId: string;
    budgetName: string;
    periodId: string;
    sourcePeriodId: string;
    periodType: PeriodType;
    periodStart: Timestamp;
    periodEnd: Timestamp;
    allocatedAmount: number;
    originalAmount: number;
    spent?: number;
    remaining?: number;
    userNotes?: string;
    modifiedAmount?: number;
    isModified: boolean;
    lastModifiedBy?: string;
    lastModifiedAt?: Timestamp;
    checklistItems: ChecklistItem[];
    lastCalculated: Timestamp;
    isActive: boolean;
}
export interface FunctionResponse<T = any> {
    success: boolean;
    data?: T;
    error?: ApiError;
    timestamp: string;
}
export interface PlaidItem extends BaseDocument {
    itemId: string;
    userId: string;
    familyId?: string;
    institutionId: string;
    institutionName: string;
    institutionLogo?: string;
    accessToken: string;
    cursor?: string;
    products: PlaidProduct[];
    availableProducts: PlaidProduct[];
    billedProducts: PlaidProduct[];
    status: PlaidItemStatus;
    error?: PlaidItemError;
    consentExpirationTime?: Timestamp;
    lastWebhookReceived?: Timestamp;
    updateMode?: PlaidUpdateMode;
    isActive: boolean;
    syncFrequency: PlaidSyncFrequency;
    lastSyncedAt?: Timestamp;
    lastFullSyncAt?: Timestamp;
    syncStats: PlaidSyncStats;
    nextScheduledSync?: Timestamp;
    webhookEnabled: boolean;
}
export declare enum PlaidProduct {
    TRANSACTIONS = "transactions",
    ACCOUNTS = "accounts",
    IDENTITY = "identity",
    ASSETS = "assets",
    LIABILITIES = "liabilities",
    INVESTMENTS = "investments",
    AUTH = "auth",
    INCOME = "income"
}
export declare enum PlaidItemStatus {
    GOOD = "ITEM_LOGIN_REQUIRED",// Item is in good state
    LOGIN_REQUIRED = "ITEM_LOGIN_REQUIRED",// User needs to update login credentials
    PENDING_EXPIRATION = "PENDING_EXPIRATION",// Item will expire soon
    EXPIRED = "EXPIRED",// Item has expired
    ERROR = "ERROR"
}
export interface PlaidItemError {
    errorType: string;
    errorCode: string;
    displayMessage?: string;
    lastOccurredAt: Timestamp;
    retryCount: number;
}
export declare enum PlaidUpdateMode {
    WEBHOOK = "webhook",// Update via webhooks (preferred)
    POLLING = "polling",// Update via scheduled polling
    MANUAL = "manual"
}
export declare enum PlaidSyncFrequency {
    REAL_TIME = "real_time",// Immediate webhook response + on-demand refresh
    STANDARD = "standard",// Multiple daily updates via webhooks
    ECONOMY = "economy",// Daily batch updates only
    MANUAL = "manual"
}
export interface PlaidSyncStats {
    totalApiCalls: number;
    totalTransactionsProcessed: number;
    lastSyncDuration: number;
    averageSyncDuration: number;
    errorCount: number;
    lastErrorAt?: Timestamp;
    costTier: PlaidSyncFrequency;
}
export interface PlaidAccount extends BaseDocument {
    userId: string;
    groupId: string | null;
    accessibleBy: string[];
    accountId: string;
    itemId: string;
    isActive: boolean;
    createdAt: Timestamp;
    access: AccessControl;
    categories: Categories & {
        accountType: PlaidAccountType;
        accountSubtype: PlaidAccountSubtype;
    };
    metadata: Metadata & {
        persistentAccountId?: string;
        verificationStatus?: PlaidVerificationStatus;
        isSyncEnabled: boolean;
        lastSyncedAt?: Timestamp;
        institution: {
            id: string;
            name: string;
            logo?: string;
        };
        linkedAt: Timestamp;
        lastBalanceUpdate: Timestamp;
    };
    relationships: Relationships;
    name: string;
    mask?: string;
    officialName?: string;
    balances: PlaidAccountBalances;
}
export declare enum PlaidAccountType {
    DEPOSITORY = "depository",// Checking, savings, etc.
    CREDIT = "credit",// Credit cards, lines of credit
    LOAN = "loan",// Mortgages, auto loans, etc.
    INVESTMENT = "investment",// Investment accounts
    OTHER = "other"
}
export declare enum PlaidAccountSubtype {
    CHECKING = "checking",
    SAVINGS = "savings",
    HSA = "hsa",
    CD = "cd",
    MONEY_MARKET = "money market",
    PAYPAL = "paypal",
    PREPAID = "prepaid",
    CREDIT_CARD = "credit card",
    PAYPAL_CREDIT = "paypal credit",
    AUTO = "auto",
    COMMERCIAL = "commercial",
    CONSTRUCTION = "construction",
    CONSUMER = "consumer",
    HOME_EQUITY = "home equity",
    MORTGAGE = "mortgage",
    OVERDRAFT = "overdraft",
    LINE_OF_CREDIT = "line of credit",
    STUDENT = "student",
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
    OTHER = "other"
}
export interface PlaidAccountBalances {
    available?: number;
    current: number;
    limit?: number;
    isoCurrencyCode?: string;
    unofficialCurrencyCode?: string;
    lastUpdated: Timestamp;
}
export declare enum PlaidVerificationStatus {
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
export interface PlaidTransaction extends BaseDocument {
    transactionId: string;
    accountId: string;
    itemId: string;
    userId: string;
    familyId?: string;
    persistentTransactionId?: string;
    amount: number;
    isoCurrencyCode?: string;
    unofficialCurrencyCode?: string;
    category: string[];
    categoryId: string;
    checkNumber?: string;
    dateTransacted: Timestamp;
    datePosted: Timestamp;
    location?: PlaidTransactionLocation;
    merchantName?: string;
    merchantEntityId?: string;
    originalDescription?: string;
    paymentMeta: PlaidPaymentMeta;
    pending: boolean;
    pendingTransactionId?: string;
    accountOwner?: string;
    authorizedDate?: Timestamp;
    authorizedDatetime?: Timestamp;
    datetime?: Timestamp;
    paymentChannel: PlaidPaymentChannel;
    personalFinanceCategory?: PlaidPersonalFinanceCategory;
    transactionCode?: PlaidTransactionCode;
    transactionType?: PlaidTransactionType;
    isProcessed: boolean;
    familyTransactionId?: string;
    isHidden: boolean;
    userCategory?: TransactionCategory;
    userNotes?: string;
    tags: string[];
    lastSyncedAt: Timestamp;
    syncVersion: number;
}
export interface PlaidTransactionLocation {
    address?: string;
    city?: string;
    region?: string;
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
export declare enum PlaidPaymentChannel {
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
    primary: string;
    detailed: string;
    confidenceLevel?: string;
}
export declare enum PlaidTransactionCode {
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
export declare enum PlaidTransactionType {
    DIGITAL = "digital",
    PLACE = "place",
    SPECIAL = "special",
    UNRESOLVED = "unresolved"
}
export interface PlaidWebhook extends BaseDocument {
    webhookType: PlaidWebhookType;
    webhookCode: PlaidWebhookCode;
    itemId?: string;
    environmentId: string;
    requestId: string;
    payload: Record<string, any>;
    processedAt?: Timestamp;
    processingStatus: PlaidWebhookProcessingStatus;
    processingError?: string;
    retryCount: number;
    signature: string;
    isValid: boolean;
}
export declare enum PlaidWebhookType {
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
export declare enum PlaidWebhookCode {
    SYNC_UPDATES_AVAILABLE = "SYNC_UPDATES_AVAILABLE",
    DEFAULT_UPDATE = "DEFAULT_UPDATE",
    INITIAL_UPDATE = "INITIAL_UPDATE",
    HISTORICAL_UPDATE = "HISTORICAL_UPDATE",
    TRANSACTIONS_REMOVED = "TRANSACTIONS_REMOVED",
    ERROR = "ERROR",
    PENDING_EXPIRATION = "PENDING_EXPIRATION",
    USER_PERMISSION_REVOKED = "USER_PERMISSION_REVOKED",
    WEBHOOK_UPDATE_ACKNOWLEDGED = "WEBHOOK_UPDATE_ACKNOWLEDGED",
    NEW_ACCOUNTS_AVAILABLE = "NEW_ACCOUNTS_AVAILABLE",
    RECURRING_TRANSACTIONS_UPDATE = "RECURRING_TRANSACTIONS_UPDATE"
}
export declare enum PlaidWebhookProcessingStatus {
    PENDING = "pending",
    PROCESSING = "processing",
    COMPLETED = "completed",
    FAILED = "failed",
    SKIPPED = "skipped"
}
export interface PlaidTransactionsSyncRequest {
    access_token: string;
    cursor?: string;
    count?: number;
    account_ids?: string[];
}
export interface PlaidTransactionsSyncResponse {
    added: PlaidTransactionSync[];
    modified: PlaidTransactionSync[];
    removed: PlaidRemovedTransaction[];
    next_cursor: string;
    has_more: boolean;
    request_id: string;
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
    apiCallsUsed: number;
}
export interface PlaidConfiguration extends BaseDocument {
    clientId: string;
    environment: PlaidEnvironment;
    products: PlaidProduct[];
    countryCodes: string[];
    webhookUrl?: string;
    isActive: boolean;
    syncSettings: {
        maxTransactionDays: number;
        frontendTransactionDays: number;
        syncFrequency: PlaidSyncFrequency;
        enableWebhooks: boolean;
        enableScheduledSync: boolean;
    };
    encryptionSettings: {
        algorithm: string;
        keyRotationDays: number;
    };
    errorHandling: {
        maxRetries: number;
        retryDelayMs: number;
        errorReportingEnabled: boolean;
    };
}
export declare enum PlaidEnvironment {
    SANDBOX = "sandbox",
    DEVELOPMENT = "development",
    PRODUCTION = "production"
}
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
    accountIds?: string[];
}
export interface SyncPlaidTransactionsRequest {
    itemId?: string;
    accountId?: string;
    startDate?: string;
    endDate?: string;
    forceFullSync?: boolean;
}
export interface PlaidTransactionSyncResponse {
    itemId: string;
    accountsCount: number;
    transactionsAdded: number;
    transactionsModified: number;
    transactionsRemoved: number;
    cursor?: string;
    hasMore: boolean;
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
export interface BaseRecurringTransaction extends BaseDocument, ResourceOwnership {
    userId: string;
    groupId: string | null;
    accessibleBy: string[];
    streamId: string;
    itemId: string;
    accountId: string;
    isActive: boolean;
    status: PlaidRecurringTransactionStatus;
    createdAt: Timestamp;
    access: AccessControl;
    categories: Categories & {
        plaidCategoryHierarchy: string[];
        plaidCategoryId: string;
        personalFinanceCategory?: PlaidPersonalFinanceCategory;
        userCategory?: TransactionCategory;
    };
    metadata: Metadata & {
        isUserModified?: boolean;
        isHidden: boolean;
        syncVersion: number;
    };
    relationships: Relationships & {
        transactionIds: string[];
    };
    description: string;
    merchantName?: string;
    averageAmount: number;
    lastAmount: number;
    frequency: PlaidRecurringFrequency;
    firstDate: Timestamp;
    lastDate: Timestamp;
    predictedNextDate?: Timestamp;
}
export interface RecurringIncome extends BaseRecurringTransaction {
    incomeType?: 'salary' | 'dividend' | 'interest' | 'rental' | 'freelance' | 'bonus' | 'other';
    isRegularSalary?: boolean;
    employerName?: string;
    taxable?: boolean;
    inflowSource?: 'user' | 'plaid';
}
export interface RecurringOutflow extends BaseRecurringTransaction {
    expenseType?: 'subscription' | 'utility' | 'loan' | 'rent' | 'insurance' | 'tax' | 'other';
    isEssential?: boolean;
    merchantCategory?: string;
    isCancellable?: boolean;
    reminderDays?: number;
    outflowSource?: 'user' | 'plaid';
}
export interface PlaidRecurringTransaction extends BaseRecurringTransaction {
    streamType: PlaidRecurringTransactionStreamType;
}
export declare enum PlaidRecurringTransactionStatus {
    MATURE = "MATURE",// Has at least 3 transactions and regular cadence
    EARLY_DETECTION = "EARLY_DETECTION"
}
export declare enum PlaidRecurringTransactionStreamType {
    INFLOW = "inflow",// Money coming in (income, refunds, etc.)
    OUTFLOW = "outflow"
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
    amount: number;
    isoCurrencyCode?: string;
    unofficialCurrencyCode?: string;
}
export declare enum PlaidRecurringFrequency {
    UNKNOWN = "UNKNOWN",
    WEEKLY = "WEEKLY",
    BIWEEKLY = "BIWEEKLY",
    SEMI_MONTHLY = "SEMI_MONTHLY",
    MONTHLY = "MONTHLY",
    ANNUALLY = "ANNUALLY"
}
export interface PlaidRecurringTransactionUpdate extends BaseDocument {
    itemId: string;
    userId: string;
    updateType: PlaidRecurringUpdateType;
    streamId?: string;
    payload: Record<string, any>;
    processedAt?: Timestamp;
    processingStatus: PlaidWebhookProcessingStatus;
    processingError?: string;
    changesApplied: {
        incomeStreamsAdded: number;
        incomeStreamsModified: number;
        incomeStreamsRemoved: number;
        outflowStreamsAdded: number;
        outflowStreamsModified: number;
        outflowStreamsRemoved: number;
        transactionsAffected: number;
    };
}
export declare enum PlaidRecurringUpdateType {
    INITIAL_DETECTION = "INITIAL_DETECTION",// First time recurring streams detected
    STREAM_UPDATES = "STREAM_UPDATES",// Updates to existing streams
    NEW_STREAMS = "NEW_STREAMS",// New recurring streams detected
    STREAM_MODIFICATIONS = "STREAM_MODIFICATIONS"
}
export interface FetchRecurringTransactionsRequest {
    itemId?: string;
    accountId?: string;
}
export interface FetchRecurringTransactionsResponse {
    itemId: string;
    accountsCount: number;
    streamsFound: number;
    streamsAdded: number;
    streamsModified: number;
    incomeStreamsAdded: number;
    outflowStreamsAdded: number;
    incomeStreamsModified: number;
    outflowStreamsModified: number;
    historicalTransactionsDays: number;
}
export interface GetUserRecurringTransactionsResponse {
    income: RecurringIncome[];
    outflows: RecurringOutflow[];
    totalIncome: number;
    totalOutflows: number;
    netFlow: number;
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
    averageAmount: PlaidRecurringAmount;
    lastAmount: PlaidRecurringAmount;
    frequency: PlaidRecurringFrequency;
    firstDate: string;
    lastDate: string;
    transactionCount: number;
}
export declare enum OutflowPeriodStatus {
    PENDING = "pending",// Not yet due, no payments
    DUE_SOON = "due_soon",// Due within 3 days
    PARTIAL = "partial",// Partially paid
    PAID = "paid",// Fully paid
    PAID_EARLY = "paid_early",// Paid before due date
    OVERDUE = "overdue"
}
/**
 * Outflow (Recurring Expense Stream) - FLAT STRUCTURE
 *
 * Represents a recurring expense detected by Plaid or manually created by users.
 * This is the NEW flat structure - all fields at root level for efficient queries.
 *
 * Document ID: Plaid stream_id (for Plaid-sourced) or auto-generated (for manual)
 */
export interface Outflow extends BaseDocument {
    id: string;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    ownerId: string;
    createdBy: string;
    updatedBy: string;
    groupId: string | null;
    plaidItemId: string;
    accountId: string;
    lastAmount: number;
    averageAmount: number;
    currency: string;
    description: string | null;
    merchantName: string | null;
    userCustomName: string | null;
    frequency: string;
    firstDate: Timestamp;
    lastDate: Timestamp;
    predictedNextDate: Timestamp | null;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    internalPrimaryCategory: string | null;
    internalDetailedCategory: string | null;
    type: string;
    expenseType: string;
    isEssential: boolean;
    source: string;
    isActive: boolean;
    isHidden: boolean;
    isUserModified: boolean;
    plaidStatus: string;
    transactionIds: string[];
    tags: string[];
    rules: any[];
}
export interface TransactionSplitReference {
    transactionId: string;
    splitId: string;
    transactionDate: Timestamp;
    amount: number;
    description: string;
    paymentType: PaymentType;
    isAutoMatched: boolean;
    matchedAt: Timestamp;
    matchedBy: string;
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
    id: string;
    dueDate: Timestamp;
    isPaid: boolean;
    transactionId: string | null;
    transactionSplitId: string | null;
    paymentDate: Timestamp | null;
    amountDue: number;
    amountPaid: number;
    paymentType: 'regular' | 'catch_up' | 'advance' | 'extra_principal' | null;
    isAutoMatched: boolean;
    matchedAt: Timestamp | null;
    matchedBy: string | null;
    notes?: string;
    tags?: string[];
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
    id: string;
    outflowId: string;
    sourcePeriodId: string;
    ownerId: string;
    createdBy: string;
    updatedBy: string;
    groupId: string | null;
    accountId: string;
    plaidItemId: string;
    actualAmount: number | null;
    amountWithheld: number;
    averageAmount: number;
    expectedAmount: number;
    amountPerOccurrence: number;
    totalAmountDue: number;
    totalAmountPaid: number;
    totalAmountUnpaid: number;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    lastCalculated: Timestamp;
    currency: string;
    cycleDays: number;
    cycleStartDate: Timestamp;
    cycleEndDate: Timestamp;
    dailyWithholdingRate: number;
    description: string;
    frequency: string;
    status?: OutflowPeriodStatus;
    isPaid: boolean;
    isFullyPaid: boolean;
    isPartiallyPaid: boolean;
    isDuePeriod: boolean;
    internalDetailedCategory: string | null;
    internalPrimaryCategory: string | null;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    isActive: boolean;
    isHidden: boolean;
    merchant: string | null;
    payee: string | null;
    periodStartDate: Timestamp;
    periodEndDate: Timestamp;
    periodType: PeriodType;
    predictedNextDate: Timestamp | null;
    rules: any[];
    tags: string[];
    type: string;
    note: string | null;
    userCustomName: string | null;
    source: string;
    transactionIds: string[];
    transactionSplits?: TransactionSplitReference[];
    occurrences?: OutflowOccurrence[];
    numberOfOccurrencesInPeriod: number;
    numberOfOccurrencesPaid: number;
    numberOfOccurrencesUnpaid: number;
    /** @deprecated Use occurrences array instead */
    occurrenceDueDates: Timestamp[];
    /** @deprecated Use occurrences array instead */
    occurrencePaidFlags: boolean[];
    /** @deprecated Use occurrences array instead */
    occurrenceTransactionIds: (string | null)[];
    paymentProgressPercentage: number;
    dollarProgressPercentage: number;
    dueDate?: Timestamp;
    expectedDueDate?: Timestamp;
    amountDue?: number;
    firstDueDateInPeriod: Timestamp | null;
    lastDueDateInPeriod: Timestamp | null;
    nextUnpaidDueDate: Timestamp | null;
}
export interface PeriodRange {
    startPeriodId: string;
    endPeriodId: string;
    periodType: PeriodType;
    count: number;
}
export interface PeriodManagementConfig {
    defaultWindowSize: number;
    edgeDetectionThreshold: number;
    maxPreloadExpansion: number;
    batchExtensionSize: number;
    maxBatchExtensionLimit: number;
    preloadStrategy: 'conservative' | 'balanced' | 'aggressive';
}
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
    id: string;
    ownerId: string;
    createdBy: string;
    updatedBy: string;
    groupId: string | null;
    plaidItemId: string;
    accountId: string;
    lastAmount: number;
    averageAmount: number;
    currency: string;
    unofficialCurrency: string | null;
    description: string | null;
    merchantName: string | null;
    userCustomName: string | null;
    frequency: string;
    firstDate: Timestamp;
    lastDate: Timestamp;
    predictedNextDate: Timestamp | null;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    plaidCategoryId: string | null;
    internalPrimaryCategory: string | null;
    internalDetailedCategory: string | null;
    incomeType: string;
    isRegularSalary: boolean;
    source: string;
    isActive: boolean;
    isHidden: boolean;
    isUserModified: boolean;
    plaidStatus: string;
    plaidConfidenceLevel: string | null;
    transactionIds: string[];
    tags: string[];
    rules: any[];
    lastSyncedAt: Timestamp;
}
/**
 * Inflow Period - FLAT STRUCTURE (Aligned with OutflowPeriod Schema)
 *
 * Represents an income stream occurrence within a specific period.
 * Supports multiple occurrences (e.g., weekly income occurring 4x in monthly period).
 *
 * All fields are at the root level for simplified security rules and efficient queries.
 */
export interface InflowPeriod extends BaseDocument {
    id: string;
    inflowId: string;
    sourcePeriodId: string;
    ownerId: string;
    createdBy: string;
    updatedBy: string;
    groupId: string | null;
    accountId: string;
    plaidItemId: string;
    actualAmount: number | null;
    amountWithheld: number;
    averageAmount: number;
    expectedAmount: number;
    amountPerOccurrence: number;
    totalAmountDue: number;
    totalAmountPaid: number;
    totalAmountUnpaid: number;
    createdAt: Timestamp;
    updatedAt: Timestamp;
    lastCalculated: Timestamp;
    currency: string;
    cycleDays: number;
    cycleStartDate: Timestamp;
    cycleEndDate: Timestamp;
    dailyWithholdingRate: number;
    description: string;
    frequency: string;
    isPaid: boolean;
    isFullyPaid: boolean;
    isPartiallyPaid: boolean;
    isReceiptPeriod: boolean;
    internalDetailedCategory: string | null;
    internalPrimaryCategory: string | null;
    plaidPrimaryCategory: string;
    plaidDetailedCategory: string;
    isActive: boolean;
    isHidden: boolean;
    merchant: string | null;
    payee: string | null;
    periodStartDate: Timestamp;
    periodEndDate: Timestamp;
    periodType: PeriodType;
    predictedNextDate: Timestamp | null;
    rules: any[];
    tags: string[];
    type: string;
    note: string | null;
    userCustomName: string | null;
    source: string;
    transactionIds: string[];
    numberOfOccurrencesInPeriod: number;
    numberOfOccurrencesPaid: number;
    numberOfOccurrencesUnpaid: number;
    occurrenceDueDates: Timestamp[];
    occurrencePaidFlags: boolean[];
    occurrenceTransactionIds: (string | null)[];
    paymentProgressPercentage: number;
    dollarProgressPercentage: number;
    firstDueDateInPeriod: Timestamp | null;
    lastDueDateInPeriod: Timestamp | null;
    nextUnpaidDueDate: Timestamp | null;
}
export interface PeriodRange {
    startPeriodId: string;
    endPeriodId: string;
    periodType: PeriodType;
    count: number;
}
export interface PeriodManagementConfig {
    defaultWindowSize: number;
    edgeDetectionThreshold: number;
    maxPreloadExpansion: number;
    batchExtensionSize: number;
    maxBatchExtensionLimit: number;
    preloadStrategy: 'conservative' | 'balanced' | 'aggressive';
}
//# sourceMappingURL=index.d.ts.map