export declare const APP_CONFIG: {
    name: string;
    version: string;
    supportEmail: string;
};
export declare const COLLECTIONS: {
    readonly USERS: "users";
    readonly FAMILIES: "families";
    readonly TRANSACTIONS: "transactions";
    readonly BUDGETS: "budgets";
    readonly RECURRING_TRANSACTIONS: "recurringTransactions";
    readonly NOTIFICATIONS: "notifications";
};
export declare const DEFAULTS: {
    readonly CURRENCY: "USD";
    readonly LOCALE: "en-US";
    readonly THEME: "auto";
    readonly BUDGET_ALERT_THRESHOLD: 80;
    readonly INVITE_EXPIRY_HOURS: 24;
    readonly MAX_FAMILY_MEMBERS: 20;
    readonly MAX_INVITE_CODES: 10;
};
export declare const LIMITS: {
    readonly TRANSACTION_DESCRIPTION_MAX: 500;
    readonly BUDGET_NAME_MAX: 100;
    readonly FAMILY_NAME_MAX: 100;
    readonly USER_NAME_MAX: 100;
    readonly TAGS_MAX_COUNT: 10;
    readonly TAG_MAX_LENGTH: 50;
    readonly QUERY_LIMIT_MAX: 100;
    readonly QUERY_LIMIT_DEFAULT: 50;
};
export declare const ERROR_CODES: {
    readonly AUTH_MISSING_TOKEN: "auth/missing-token";
    readonly AUTH_INVALID_TOKEN: "auth/invalid-token";
    readonly AUTH_USER_NOT_FOUND: "auth/user-not-found";
    readonly AUTH_USER_INACTIVE: "auth/user-inactive";
    readonly AUTH_INSUFFICIENT_PERMISSIONS: "auth/insufficient-permissions";
    readonly AUTH_VERIFICATION_FAILED: "auth/verification-failed";
    readonly VALIDATION_ERROR: "validation-error";
    readonly MISSING_PARAMETER: "missing-parameter";
    readonly INVALID_DATA: "invalid-data";
    readonly RESOURCE_NOT_FOUND: "resource-not-found";
    readonly FAMILY_NOT_FOUND: "family-not-found";
    readonly TRANSACTION_NOT_FOUND: "transaction-not-found";
    readonly BUDGET_NOT_FOUND: "budget-not-found";
    readonly USER_NOT_FOUND: "user-not-found";
    readonly ACCESS_DENIED: "access-denied";
    readonly PERMISSION_DENIED: "permission-denied";
    readonly NOT_FAMILY_ADMIN: "not-family-admin";
    readonly DIFFERENT_FAMILY: "different-family";
    readonly ALREADY_IN_FAMILY: "already-in-family";
    readonly NO_FAMILY: "no-family";
    readonly INVALID_INVITE: "invalid-invite";
    readonly CANNOT_REMOVE_SELF: "cannot-remove-self";
    readonly TRANSFER_ADMIN_FIRST: "transfer-admin-first";
    readonly CANNOT_DELETE_ADMIN: "cannot-delete-admin";
    readonly INTERNAL_ERROR: "internal-error";
    readonly METHOD_NOT_ALLOWED: "method-not-allowed";
};
export declare const NOTIFICATION_TEMPLATES: {
    readonly TRANSACTION_CREATED: {
        readonly title: "New Transaction";
        readonly body: "A new transaction has been created: {description} - {amount} {currency}";
    };
    readonly TRANSACTION_APPROVED: {
        readonly title: "Transaction Approved";
        readonly body: "Your transaction has been approved: {description} - {amount} {currency}";
    };
    readonly TRANSACTION_REJECTED: {
        readonly title: "Transaction Rejected";
        readonly body: "Your transaction has been rejected: {description} - {amount} {currency}";
    };
    readonly BUDGET_WARNING: {
        readonly title: "Budget Warning";
        readonly body: "You've spent {percentage}% of your {budgetName} budget";
    };
    readonly BUDGET_EXCEEDED: {
        readonly title: "Budget Exceeded";
        readonly body: "You've exceeded your {budgetName} budget by {amount} {currency}";
    };
    readonly FAMILY_INVITATION: {
        readonly title: "Family Invitation";
        readonly body: "You've been invited to join the {familyName} family";
    };
};
export declare const CORS_CONFIG: {
    origin: string[];
    credentials: boolean;
    methods: string[];
    allowedHeaders: string[];
};
export declare const RATE_LIMITS: {
    readonly TRANSACTION_CREATE_PER_MINUTE: 10;
    readonly INVITE_CREATE_PER_HOUR: 5;
    readonly AUTH_ATTEMPTS_PER_HOUR: 20;
};
export declare const CACHE_TTL: {
    readonly USER_PROFILE: 300;
    readonly FAMILY_DATA: 600;
    readonly BUDGET_DATA: 180;
    readonly STATISTICS: 900;
};
export declare const REGIONS: {
    readonly DEFAULT: "us-central1";
    readonly EUROPE: "europe-west1";
    readonly ASIA: "asia-northeast1";
};
export declare const EMAIL_TEMPLATES: {
    readonly WELCOME: "welcome";
    readonly FAMILY_INVITE: "family-invite";
    readonly BUDGET_ALERT: "budget-alert";
    readonly WEEKLY_REPORT: "weekly-report";
};
export declare const SUPPORTED_CURRENCIES: readonly ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "BRL", "KRW", "SGD", "HKD", "NOK", "SEK", "DKK", "PLN", "CZK", "HUF", "RON"];
export declare const SUPPORTED_LOCALES: readonly ["en-US", "en-GB", "es-ES", "fr-FR", "de-DE", "it-IT", "pt-BR", "ja-JP", "ko-KR", "zh-CN", "zh-TW", "hi-IN", "ar-SA", "ru-RU"];
//# sourceMappingURL=constants.d.ts.map