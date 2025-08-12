// Application constants
export const APP_CONFIG = {
  name: "FamilyFinance",
  version: "1.0.0",
  supportEmail: "support@familyfinance.app",
};

// Firebase collection names
export const COLLECTIONS = {
  USERS: "users",
  FAMILIES: "families",
  TRANSACTIONS: "transactions",
  BUDGETS: "budgets",
  RECURRING_TRANSACTIONS: "recurringTransactions",
  NOTIFICATIONS: "notifications",
} as const;

// Default values
export const DEFAULTS = {
  CURRENCY: "USD",
  LOCALE: "en-US",
  THEME: "auto" as const,
  BUDGET_ALERT_THRESHOLD: 80,
  INVITE_EXPIRY_HOURS: 24,
  MAX_FAMILY_MEMBERS: 20,
  MAX_INVITE_CODES: 10,
} as const;

// Validation limits
export const LIMITS = {
  TRANSACTION_DESCRIPTION_MAX: 500,
  BUDGET_NAME_MAX: 100,
  FAMILY_NAME_MAX: 100,
  USER_NAME_MAX: 100,
  TAGS_MAX_COUNT: 10,
  TAG_MAX_LENGTH: 50,
  QUERY_LIMIT_MAX: 100,
  QUERY_LIMIT_DEFAULT: 50,
} as const;

// Error codes
export const ERROR_CODES = {
  // Authentication errors
  AUTH_MISSING_TOKEN: "auth/missing-token",
  AUTH_INVALID_TOKEN: "auth/invalid-token",
  AUTH_USER_NOT_FOUND: "auth/user-not-found",
  AUTH_USER_INACTIVE: "auth/user-inactive",
  AUTH_INSUFFICIENT_PERMISSIONS: "auth/insufficient-permissions",
  AUTH_VERIFICATION_FAILED: "auth/verification-failed",

  // Validation errors
  VALIDATION_ERROR: "validation-error",
  MISSING_PARAMETER: "missing-parameter",
  INVALID_DATA: "invalid-data",

  // Resource errors
  RESOURCE_NOT_FOUND: "resource-not-found",
  FAMILY_NOT_FOUND: "family-not-found",
  TRANSACTION_NOT_FOUND: "transaction-not-found",
  BUDGET_NOT_FOUND: "budget-not-found",
  USER_NOT_FOUND: "user-not-found",

  // Permission errors
  ACCESS_DENIED: "access-denied",
  PERMISSION_DENIED: "permission-denied",
  NOT_FAMILY_ADMIN: "not-family-admin",
  DIFFERENT_FAMILY: "different-family",

  // Business logic errors
  ALREADY_IN_FAMILY: "already-in-family",
  NO_FAMILY: "no-family",
  INVALID_INVITE: "invalid-invite",
  CANNOT_REMOVE_SELF: "cannot-remove-self",
  TRANSFER_ADMIN_FIRST: "transfer-admin-first",
  CANNOT_DELETE_ADMIN: "cannot-delete-admin",

  // Generic errors
  INTERNAL_ERROR: "internal-error",
  METHOD_NOT_ALLOWED: "method-not-allowed",
} as const;

// Notification templates
export const NOTIFICATION_TEMPLATES = {
  TRANSACTION_CREATED: {
    title: "New Transaction",
    body: "A new transaction has been created: {description} - {amount} {currency}",
  },
  TRANSACTION_APPROVED: {
    title: "Transaction Approved",
    body: "Your transaction has been approved: {description} - {amount} {currency}",
  },
  TRANSACTION_REJECTED: {
    title: "Transaction Rejected",
    body: "Your transaction has been rejected: {description} - {amount} {currency}",
  },
  BUDGET_WARNING: {
    title: "Budget Warning",
    body: "You've spent {percentage}% of your {budgetName} budget",
  },
  BUDGET_EXCEEDED: {
    title: "Budget Exceeded",
    body: "You've exceeded your {budgetName} budget by {amount} {currency}",
  },
  FAMILY_INVITATION: {
    title: "Family Invitation",
    body: "You've been invited to join the {familyName} family",
  },
} as const;

// CORS settings
export const CORS_CONFIG = {
  origin: [
    "http://localhost:3000",
    "http://localhost:8081",
    "https://family-finance-app.web.app",
    "https://family-finance-app.firebaseapp.com",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Rate limiting
export const RATE_LIMITS = {
  TRANSACTION_CREATE_PER_MINUTE: 10,
  INVITE_CREATE_PER_HOUR: 5,
  AUTH_ATTEMPTS_PER_HOUR: 20,
} as const;

// Cache settings
export const CACHE_TTL = {
  USER_PROFILE: 300, // 5 minutes
  FAMILY_DATA: 600, // 10 minutes
  BUDGET_DATA: 180, // 3 minutes
  STATISTICS: 900, // 15 minutes
} as const;

// Firebase Functions regions
export const REGIONS = {
  DEFAULT: "us-central1",
  EUROPE: "europe-west1",
  ASIA: "asia-northeast1",
} as const;

// Email templates (for future email functionality)
export const EMAIL_TEMPLATES = {
  WELCOME: "welcome",
  FAMILY_INVITE: "family-invite",
  BUDGET_ALERT: "budget-alert",
  WEEKLY_REPORT: "weekly-report",
} as const;

// Currency codes (subset of common currencies)
export const SUPPORTED_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "BRL",
  "KRW", "SGD", "HKD", "NOK", "SEK", "DKK", "PLN", "CZK", "HUF", "RON",
] as const;

// Locales (subset of supported locales)
export const SUPPORTED_LOCALES = [
  "en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "it-IT", "pt-BR",
  "ja-JP", "ko-KR", "zh-CN", "zh-TW", "hi-IN", "ar-SA", "ru-RU",
] as const;