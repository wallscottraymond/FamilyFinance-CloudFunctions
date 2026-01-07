"use strict";
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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutflowPeriodStatus = exports.PlaidRecurringUpdateType = exports.PlaidRecurringFrequency = exports.PlaidRecurringTransactionStreamType = exports.PlaidRecurringTransactionStatus = exports.PlaidEnvironment = exports.PlaidWebhookProcessingStatus = exports.PlaidWebhookCode = exports.PlaidWebhookType = exports.PlaidTransactionType = exports.PlaidTransactionCode = exports.PlaidPaymentChannel = exports.PlaidVerificationStatus = exports.PlaidAccountSubtype = exports.PlaidAccountType = exports.PlaidSyncFrequency = exports.PlaidUpdateMode = exports.PlaidItemStatus = exports.PlaidProduct = exports.PeriodType = exports.NotificationPriority = exports.NotificationType = exports.RecurrenceFrequency = exports.BudgetPeriod = exports.TransactionCategory = exports.TransactionStatus = exports.TransactionType = exports.PaymentType = exports.UserRole = void 0;
// Export new modular types
__exportStar(require("./users"), exports);
__exportStar(require("./groups"), exports);
__exportStar(require("./sharing"), exports);
__exportStar(require("./outflowSummaries"), exports);
// Legacy enum - kept for backward compatibility
var UserRole;
(function (UserRole) {
    UserRole["ADMIN"] = "admin";
    UserRole["EDITOR"] = "editor";
    UserRole["VIEWER"] = "viewer";
})(UserRole || (exports.UserRole = UserRole = {}));
// Transaction related types
// Payment Type enum for transaction splits
var PaymentType;
(function (PaymentType) {
    PaymentType["REGULAR"] = "regular";
    PaymentType["CATCH_UP"] = "catch_up";
    PaymentType["ADVANCE"] = "advance";
    PaymentType["EXTRA_PRINCIPAL"] = "extra_principal"; // Additional payment beyond required amount
})(PaymentType || (exports.PaymentType = PaymentType = {}));
var TransactionType;
(function (TransactionType) {
    TransactionType["INCOME"] = "income";
    TransactionType["EXPENSE"] = "expense";
    TransactionType["TRANSFER"] = "transfer";
})(TransactionType || (exports.TransactionType = TransactionType = {}));
var TransactionStatus;
(function (TransactionStatus) {
    TransactionStatus["PENDING"] = "pending";
    TransactionStatus["APPROVED"] = "approved";
    TransactionStatus["REJECTED"] = "rejected";
    TransactionStatus["CANCELLED"] = "cancelled";
})(TransactionStatus || (exports.TransactionStatus = TransactionStatus = {}));
var TransactionCategory;
(function (TransactionCategory) {
    // Income categories
    TransactionCategory["SALARY"] = "salary";
    TransactionCategory["ALLOWANCE"] = "allowance";
    TransactionCategory["INVESTMENT"] = "investment";
    TransactionCategory["GIFT"] = "gift";
    TransactionCategory["OTHER_INCOME"] = "other_income";
    // Expense categories
    TransactionCategory["FOOD"] = "food";
    TransactionCategory["TRANSPORTATION"] = "transportation";
    TransactionCategory["HOUSING"] = "housing";
    TransactionCategory["UTILITIES"] = "utilities";
    TransactionCategory["HEALTHCARE"] = "healthcare";
    TransactionCategory["EDUCATION"] = "education";
    TransactionCategory["ENTERTAINMENT"] = "entertainment";
    TransactionCategory["CLOTHING"] = "clothing";
    TransactionCategory["PERSONAL_CARE"] = "personal_care";
    TransactionCategory["SAVINGS"] = "savings";
    TransactionCategory["DEBT_PAYMENT"] = "debt_payment";
    TransactionCategory["INSURANCE"] = "insurance";
    TransactionCategory["TAXES"] = "taxes";
    TransactionCategory["CHARITY"] = "charity";
    TransactionCategory["OTHER_EXPENSE"] = "other_expense";
})(TransactionCategory || (exports.TransactionCategory = TransactionCategory = {}));
var BudgetPeriod;
(function (BudgetPeriod) {
    BudgetPeriod["WEEKLY"] = "weekly";
    BudgetPeriod["MONTHLY"] = "monthly";
    BudgetPeriod["QUARTERLY"] = "quarterly";
    BudgetPeriod["YEARLY"] = "yearly";
    BudgetPeriod["CUSTOM"] = "custom";
})(BudgetPeriod || (exports.BudgetPeriod = BudgetPeriod = {}));
var RecurrenceFrequency;
(function (RecurrenceFrequency) {
    RecurrenceFrequency["DAILY"] = "daily";
    RecurrenceFrequency["WEEKLY"] = "weekly";
    RecurrenceFrequency["BIWEEKLY"] = "biweekly";
    RecurrenceFrequency["MONTHLY"] = "monthly";
    RecurrenceFrequency["QUARTERLY"] = "quarterly";
    RecurrenceFrequency["YEARLY"] = "yearly";
})(RecurrenceFrequency || (exports.RecurrenceFrequency = RecurrenceFrequency = {}));
var NotificationType;
(function (NotificationType) {
    NotificationType["TRANSACTION_CREATED"] = "transaction_created";
    NotificationType["TRANSACTION_APPROVED"] = "transaction_approved";
    NotificationType["TRANSACTION_REJECTED"] = "transaction_rejected";
    NotificationType["BUDGET_EXCEEDED"] = "budget_exceeded";
    NotificationType["BUDGET_WARNING"] = "budget_warning";
    NotificationType["FAMILY_INVITATION"] = "family_invitation";
    NotificationType["WEEKLY_REPORT"] = "weekly_report";
    NotificationType["SYSTEM_ANNOUNCEMENT"] = "system_announcement";
})(NotificationType || (exports.NotificationType = NotificationType = {}));
var NotificationPriority;
(function (NotificationPriority) {
    NotificationPriority["LOW"] = "low";
    NotificationPriority["NORMAL"] = "normal";
    NotificationPriority["HIGH"] = "high";
    NotificationPriority["URGENT"] = "urgent";
})(NotificationPriority || (exports.NotificationPriority = NotificationPriority = {}));
var PeriodType;
(function (PeriodType) {
    PeriodType["WEEKLY"] = "weekly";
    PeriodType["MONTHLY"] = "monthly";
    PeriodType["BI_MONTHLY"] = "bi_monthly";
})(PeriodType || (exports.PeriodType = PeriodType = {}));
var PlaidProduct;
(function (PlaidProduct) {
    PlaidProduct["TRANSACTIONS"] = "transactions";
    PlaidProduct["ACCOUNTS"] = "accounts";
    PlaidProduct["IDENTITY"] = "identity";
    PlaidProduct["ASSETS"] = "assets";
    PlaidProduct["LIABILITIES"] = "liabilities";
    PlaidProduct["INVESTMENTS"] = "investments";
    PlaidProduct["AUTH"] = "auth";
    PlaidProduct["INCOME"] = "income";
})(PlaidProduct || (exports.PlaidProduct = PlaidProduct = {}));
var PlaidItemStatus;
(function (PlaidItemStatus) {
    PlaidItemStatus["GOOD"] = "ITEM_LOGIN_REQUIRED";
    PlaidItemStatus["LOGIN_REQUIRED"] = "ITEM_LOGIN_REQUIRED";
    PlaidItemStatus["PENDING_EXPIRATION"] = "PENDING_EXPIRATION";
    PlaidItemStatus["EXPIRED"] = "EXPIRED";
    PlaidItemStatus["ERROR"] = "ERROR"; // Item is in error state
})(PlaidItemStatus || (exports.PlaidItemStatus = PlaidItemStatus = {}));
var PlaidUpdateMode;
(function (PlaidUpdateMode) {
    PlaidUpdateMode["WEBHOOK"] = "webhook";
    PlaidUpdateMode["POLLING"] = "polling";
    PlaidUpdateMode["MANUAL"] = "manual"; // Manual update only
})(PlaidUpdateMode || (exports.PlaidUpdateMode = PlaidUpdateMode = {}));
// Enhanced sync frequency options for cost optimization
var PlaidSyncFrequency;
(function (PlaidSyncFrequency) {
    PlaidSyncFrequency["REAL_TIME"] = "real_time";
    PlaidSyncFrequency["STANDARD"] = "standard";
    PlaidSyncFrequency["ECONOMY"] = "economy";
    PlaidSyncFrequency["MANUAL"] = "manual"; // User-triggered sync only
})(PlaidSyncFrequency || (exports.PlaidSyncFrequency = PlaidSyncFrequency = {}));
var PlaidAccountType;
(function (PlaidAccountType) {
    PlaidAccountType["DEPOSITORY"] = "depository";
    PlaidAccountType["CREDIT"] = "credit";
    PlaidAccountType["LOAN"] = "loan";
    PlaidAccountType["INVESTMENT"] = "investment";
    PlaidAccountType["OTHER"] = "other"; // Other account types
})(PlaidAccountType || (exports.PlaidAccountType = PlaidAccountType = {}));
var PlaidAccountSubtype;
(function (PlaidAccountSubtype) {
    // Depository subtypes
    PlaidAccountSubtype["CHECKING"] = "checking";
    PlaidAccountSubtype["SAVINGS"] = "savings";
    PlaidAccountSubtype["HSA"] = "hsa";
    PlaidAccountSubtype["CD"] = "cd";
    PlaidAccountSubtype["MONEY_MARKET"] = "money market";
    PlaidAccountSubtype["PAYPAL"] = "paypal";
    PlaidAccountSubtype["PREPAID"] = "prepaid";
    // Credit subtypes  
    PlaidAccountSubtype["CREDIT_CARD"] = "credit card";
    PlaidAccountSubtype["PAYPAL_CREDIT"] = "paypal credit";
    // Loan subtypes
    PlaidAccountSubtype["AUTO"] = "auto";
    PlaidAccountSubtype["COMMERCIAL"] = "commercial";
    PlaidAccountSubtype["CONSTRUCTION"] = "construction";
    PlaidAccountSubtype["CONSUMER"] = "consumer";
    PlaidAccountSubtype["HOME_EQUITY"] = "home equity";
    PlaidAccountSubtype["MORTGAGE"] = "mortgage";
    PlaidAccountSubtype["OVERDRAFT"] = "overdraft";
    PlaidAccountSubtype["LINE_OF_CREDIT"] = "line of credit";
    PlaidAccountSubtype["STUDENT"] = "student";
    // Investment subtypes
    PlaidAccountSubtype["INVESTMENT_401A"] = "401a";
    PlaidAccountSubtype["INVESTMENT_401K"] = "401k";
    PlaidAccountSubtype["INVESTMENT_403B"] = "403b";
    PlaidAccountSubtype["INVESTMENT_457B"] = "457b";
    PlaidAccountSubtype["INVESTMENT_529"] = "529";
    PlaidAccountSubtype["BROKERAGE"] = "brokerage";
    PlaidAccountSubtype["CASH_ISA"] = "cash isa";
    PlaidAccountSubtype["EDUCATION_SAVINGS_ACCOUNT"] = "education savings account";
    PlaidAccountSubtype["FIXED_ANNUITY"] = "fixed annuity";
    PlaidAccountSubtype["GIC"] = "gic";
    PlaidAccountSubtype["HEALTH_REIMBURSEMENT_ARRANGEMENT"] = "health reimbursement arrangement";
    PlaidAccountSubtype["IRA"] = "ira";
    PlaidAccountSubtype["ISA"] = "isa";
    PlaidAccountSubtype["KEOGH"] = "keogh";
    PlaidAccountSubtype["LIF"] = "lif";
    PlaidAccountSubtype["LIFE_INSURANCE"] = "life insurance";
    PlaidAccountSubtype["LIRA"] = "lira";
    PlaidAccountSubtype["LRIF"] = "lrif";
    PlaidAccountSubtype["LRSP"] = "lrsp";
    PlaidAccountSubtype["NON_CUSTODIAL_WALLET"] = "non-custodial wallet";
    PlaidAccountSubtype["NON_TAXABLE_INVESTMENT_ACCOUNT"] = "non-taxable investment account";
    PlaidAccountSubtype["PENSION"] = "pension";
    PlaidAccountSubtype["PLAN"] = "plan";
    PlaidAccountSubtype["PRIF"] = "prif";
    PlaidAccountSubtype["PROFIT_SHARING_PLAN"] = "profit sharing plan";
    PlaidAccountSubtype["RDSP"] = "rdsp";
    PlaidAccountSubtype["RESP"] = "resp";
    PlaidAccountSubtype["RETIREMENT"] = "retirement";
    PlaidAccountSubtype["RLIF"] = "rlif";
    PlaidAccountSubtype["ROTH"] = "roth";
    PlaidAccountSubtype["ROTH_401K"] = "roth 401k";
    PlaidAccountSubtype["RRIF"] = "rrif";
    PlaidAccountSubtype["RRSP"] = "rrsp";
    PlaidAccountSubtype["SARSEP"] = "sarsep";
    PlaidAccountSubtype["SEP_IRA"] = "sep ira";
    PlaidAccountSubtype["SIMPLE_IRA"] = "simple ira";
    PlaidAccountSubtype["SIPP"] = "sipp";
    PlaidAccountSubtype["STOCK_PLAN"] = "stock plan";
    PlaidAccountSubtype["TFSA"] = "tfsa";
    PlaidAccountSubtype["TRUST"] = "trust";
    PlaidAccountSubtype["UGMA"] = "ugma";
    PlaidAccountSubtype["UTMA"] = "utma";
    PlaidAccountSubtype["VARIABLE_ANNUITY"] = "variable annuity";
    // Other
    PlaidAccountSubtype["OTHER"] = "other";
})(PlaidAccountSubtype || (exports.PlaidAccountSubtype = PlaidAccountSubtype = {}));
var PlaidVerificationStatus;
(function (PlaidVerificationStatus) {
    PlaidVerificationStatus["PENDING_AUTOMATIC_VERIFICATION"] = "pending_automatic_verification";
    PlaidVerificationStatus["PENDING_MANUAL_VERIFICATION"] = "pending_manual_verification";
    PlaidVerificationStatus["MANUALLY_VERIFIED"] = "manually_verified";
    PlaidVerificationStatus["VERIFICATION_EXPIRED"] = "verification_expired";
    PlaidVerificationStatus["VERIFICATION_FAILED"] = "verification_failed";
    PlaidVerificationStatus["DATABASE_MATCHED"] = "database_matched";
    PlaidVerificationStatus["DATABASE_INSIGHTS_PASS"] = "database_insights_pass";
    PlaidVerificationStatus["DATABASE_INSIGHTS_PASS_WITH_CAUTION"] = "database_insights_pass_with_caution";
    PlaidVerificationStatus["DATABASE_INSIGHTS_FAIL"] = "database_insights_fail";
})(PlaidVerificationStatus || (exports.PlaidVerificationStatus = PlaidVerificationStatus = {}));
var PlaidPaymentChannel;
(function (PlaidPaymentChannel) {
    PlaidPaymentChannel["ONLINE"] = "online";
    PlaidPaymentChannel["IN_STORE"] = "in store";
    PlaidPaymentChannel["ATM"] = "atm";
    PlaidPaymentChannel["KIOSK"] = "kiosk";
    PlaidPaymentChannel["MOBILE"] = "mobile";
    PlaidPaymentChannel["MAIL"] = "mail";
    PlaidPaymentChannel["TELEPHONE"] = "telephone";
    PlaidPaymentChannel["OTHER"] = "other";
})(PlaidPaymentChannel || (exports.PlaidPaymentChannel = PlaidPaymentChannel = {}));
var PlaidTransactionCode;
(function (PlaidTransactionCode) {
    PlaidTransactionCode["ADJUSTMENT"] = "adjustment";
    PlaidTransactionCode["ATM"] = "atm";
    PlaidTransactionCode["BANK_CHARGE"] = "bank charge";
    PlaidTransactionCode["BILL_PAYMENT"] = "bill payment";
    PlaidTransactionCode["CASH"] = "cash";
    PlaidTransactionCode["CASHBACK"] = "cashback";
    PlaidTransactionCode["CHEQUE"] = "cheque";
    PlaidTransactionCode["DIRECT_DEBIT"] = "direct debit";
    PlaidTransactionCode["INTEREST"] = "interest";
    PlaidTransactionCode["PURCHASE"] = "purchase";
    PlaidTransactionCode["STANDING_ORDER"] = "standing order";
    PlaidTransactionCode["TRANSFER"] = "transfer";
    PlaidTransactionCode["NULL"] = "null";
})(PlaidTransactionCode || (exports.PlaidTransactionCode = PlaidTransactionCode = {}));
var PlaidTransactionType;
(function (PlaidTransactionType) {
    PlaidTransactionType["DIGITAL"] = "digital";
    PlaidTransactionType["PLACE"] = "place";
    PlaidTransactionType["SPECIAL"] = "special";
    PlaidTransactionType["UNRESOLVED"] = "unresolved";
})(PlaidTransactionType || (exports.PlaidTransactionType = PlaidTransactionType = {}));
var PlaidWebhookType;
(function (PlaidWebhookType) {
    PlaidWebhookType["TRANSACTIONS"] = "TRANSACTIONS";
    PlaidWebhookType["ITEM"] = "ITEM";
    PlaidWebhookType["AUTH"] = "AUTH";
    PlaidWebhookType["IDENTITY"] = "IDENTITY";
    PlaidWebhookType["ASSETS"] = "ASSETS";
    PlaidWebhookType["HOLDINGS"] = "HOLDINGS";
    PlaidWebhookType["INVESTMENTS_TRANSACTIONS"] = "INVESTMENTS_TRANSACTIONS";
    PlaidWebhookType["LIABILITIES"] = "LIABILITIES";
    PlaidWebhookType["TRANSFER"] = "TRANSFER";
    PlaidWebhookType["BANK_TRANSFER"] = "BANK_TRANSFER";
    PlaidWebhookType["INCOME"] = "INCOME";
    PlaidWebhookType["SIGNAL"] = "SIGNAL";
    PlaidWebhookType["RECURRING_TRANSACTIONS"] = "RECURRING_TRANSACTIONS";
})(PlaidWebhookType || (exports.PlaidWebhookType = PlaidWebhookType = {}));
var PlaidWebhookCode;
(function (PlaidWebhookCode) {
    // TRANSACTIONS webhooks
    PlaidWebhookCode["SYNC_UPDATES_AVAILABLE"] = "SYNC_UPDATES_AVAILABLE";
    PlaidWebhookCode["DEFAULT_UPDATE"] = "DEFAULT_UPDATE";
    PlaidWebhookCode["INITIAL_UPDATE"] = "INITIAL_UPDATE";
    PlaidWebhookCode["HISTORICAL_UPDATE"] = "HISTORICAL_UPDATE";
    PlaidWebhookCode["TRANSACTIONS_REMOVED"] = "TRANSACTIONS_REMOVED";
    // ITEM webhooks
    PlaidWebhookCode["ERROR"] = "ERROR";
    PlaidWebhookCode["PENDING_EXPIRATION"] = "PENDING_EXPIRATION";
    PlaidWebhookCode["USER_PERMISSION_REVOKED"] = "USER_PERMISSION_REVOKED";
    PlaidWebhookCode["WEBHOOK_UPDATE_ACKNOWLEDGED"] = "WEBHOOK_UPDATE_ACKNOWLEDGED";
    PlaidWebhookCode["NEW_ACCOUNTS_AVAILABLE"] = "NEW_ACCOUNTS_AVAILABLE";
    // RECURRING_TRANSACTIONS webhooks
    PlaidWebhookCode["RECURRING_TRANSACTIONS_UPDATE"] = "RECURRING_TRANSACTIONS_UPDATE";
})(PlaidWebhookCode || (exports.PlaidWebhookCode = PlaidWebhookCode = {}));
var PlaidWebhookProcessingStatus;
(function (PlaidWebhookProcessingStatus) {
    PlaidWebhookProcessingStatus["PENDING"] = "pending";
    PlaidWebhookProcessingStatus["PROCESSING"] = "processing";
    PlaidWebhookProcessingStatus["COMPLETED"] = "completed";
    PlaidWebhookProcessingStatus["FAILED"] = "failed";
    PlaidWebhookProcessingStatus["SKIPPED"] = "skipped";
})(PlaidWebhookProcessingStatus || (exports.PlaidWebhookProcessingStatus = PlaidWebhookProcessingStatus = {}));
var PlaidEnvironment;
(function (PlaidEnvironment) {
    PlaidEnvironment["SANDBOX"] = "sandbox";
    PlaidEnvironment["DEVELOPMENT"] = "development";
    PlaidEnvironment["PRODUCTION"] = "production";
})(PlaidEnvironment || (exports.PlaidEnvironment = PlaidEnvironment = {}));
var PlaidRecurringTransactionStatus;
(function (PlaidRecurringTransactionStatus) {
    PlaidRecurringTransactionStatus["MATURE"] = "MATURE";
    PlaidRecurringTransactionStatus["EARLY_DETECTION"] = "EARLY_DETECTION"; // First appears before becoming mature
})(PlaidRecurringTransactionStatus || (exports.PlaidRecurringTransactionStatus = PlaidRecurringTransactionStatus = {}));
var PlaidRecurringTransactionStreamType;
(function (PlaidRecurringTransactionStreamType) {
    PlaidRecurringTransactionStreamType["INFLOW"] = "inflow";
    PlaidRecurringTransactionStreamType["OUTFLOW"] = "outflow"; // Money going out (expenses, bills, etc.)
})(PlaidRecurringTransactionStreamType || (exports.PlaidRecurringTransactionStreamType = PlaidRecurringTransactionStreamType = {}));
var PlaidRecurringFrequency;
(function (PlaidRecurringFrequency) {
    PlaidRecurringFrequency["UNKNOWN"] = "UNKNOWN";
    PlaidRecurringFrequency["WEEKLY"] = "WEEKLY";
    PlaidRecurringFrequency["BIWEEKLY"] = "BIWEEKLY";
    PlaidRecurringFrequency["SEMI_MONTHLY"] = "SEMI_MONTHLY";
    PlaidRecurringFrequency["MONTHLY"] = "MONTHLY";
    PlaidRecurringFrequency["ANNUALLY"] = "ANNUALLY";
})(PlaidRecurringFrequency || (exports.PlaidRecurringFrequency = PlaidRecurringFrequency = {}));
var PlaidRecurringUpdateType;
(function (PlaidRecurringUpdateType) {
    PlaidRecurringUpdateType["INITIAL_DETECTION"] = "INITIAL_DETECTION";
    PlaidRecurringUpdateType["STREAM_UPDATES"] = "STREAM_UPDATES";
    PlaidRecurringUpdateType["NEW_STREAMS"] = "NEW_STREAMS";
    PlaidRecurringUpdateType["STREAM_MODIFICATIONS"] = "STREAM_MODIFICATIONS"; // Changes to stream classification
})(PlaidRecurringUpdateType || (exports.PlaidRecurringUpdateType = PlaidRecurringUpdateType = {}));
// =======================
// OUTFLOW PERIODS TYPES
// =======================
// Outflow Period Status enum
var OutflowPeriodStatus;
(function (OutflowPeriodStatus) {
    OutflowPeriodStatus["PENDING"] = "pending";
    OutflowPeriodStatus["DUE_SOON"] = "due_soon";
    OutflowPeriodStatus["PARTIAL"] = "partial";
    OutflowPeriodStatus["PAID"] = "paid";
    OutflowPeriodStatus["PAID_EARLY"] = "paid_early";
    OutflowPeriodStatus["OVERDUE"] = "overdue"; // Past due, unpaid
})(OutflowPeriodStatus || (exports.OutflowPeriodStatus = OutflowPeriodStatus = {}));
//# sourceMappingURL=index.js.map