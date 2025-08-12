import { Timestamp } from "firebase-admin/firestore";

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
  familyId?: string;
  role: UserRole;
  preferences: UserPreferences;
  isActive: boolean;
}

export enum UserRole {
  ADMIN = "admin",
  PARENT = "parent",
  CHILD = "child",
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
  allowChildTransactions: boolean;
}

// Transaction related types
export interface Transaction extends BaseDocument {
  userId: string;
  familyId: string;
  amount: number;
  currency: string;
  description: string;
  category: TransactionCategory;
  type: TransactionType;
  date: Timestamp;
  location?: TransactionLocation;
  receiptUrl?: string;
  tags: string[];
  budgetId?: string;
  recurringTransactionId?: string;
  status: TransactionStatus;
  approvedBy?: string;
  approvedAt?: Timestamp;
  metadata: Record<string, any>;
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
  familyId: string;
  createdBy: string;
  amount: number;
  currency: string;
  category: TransactionCategory;
  period: BudgetPeriod;
  startDate: Timestamp;
  endDate: Timestamp;
  spent: number;
  remaining: number;
  alertThreshold: number; // Percentage (0-100)
  isActive: boolean;
  memberIds: string[]; // Users who can spend from this budget
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
  category: TransactionCategory;
  type: TransactionType;
  date?: string; // ISO date string
  location?: TransactionLocation;
  tags?: string[];
  budgetId?: string;
}

export interface UpdateTransactionRequest {
  amount?: number;
  description?: string;
  category?: TransactionCategory;
  location?: TransactionLocation;
  tags?: string[];
}

export interface CreateBudgetRequest {
  name: string;
  description?: string;
  amount: number;
  category: TransactionCategory;
  period: BudgetPeriod;
  startDate: string; // ISO date string
  endDate?: string; // ISO date string
  alertThreshold?: number;
  memberIds?: string[];
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

// Function response types
export interface FunctionResponse<T = any> {
  success: boolean;
  data?: T;
  error?: ApiError;
  timestamp: string;
}