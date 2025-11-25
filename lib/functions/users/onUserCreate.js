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
Object.defineProperty(exports, "__esModule", { value: true });
exports.onUserCreate = void 0;
const functions = __importStar(require("firebase-functions"));
const types_1 = require("../../types");
const firestore_1 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
/**
 * Create user profile (triggered on user registration)
 * This function automatically creates a comprehensive user document in Firestore
 * when a new user registers via Firebase Authentication
 */
exports.onUserCreate = functions.region("us-central1").runWith({
    memory: "512MB",
    timeoutSeconds: 60
}).auth.user().onCreate(async (userRecord) => {
    var _a;
    try {
        // Get user's locale and timezone from provider data if available
        const providerData = userRecord.providerData[0];
        const detectedLocale = getLocaleFromProviderOrDefault(providerData);
        const detectedCurrency = getCurrencyFromLocale(detectedLocale);
        // Create comprehensive default preferences
        const defaultPreferences = {
            currency: detectedCurrency,
            locale: detectedLocale,
            theme: "auto",
            notifications: {
                email: true,
                push: true,
                transactionAlerts: true,
                budgetAlerts: true,
                weeklyReports: false,
                monthlyReports: true,
                goalReminders: true,
                billReminders: true,
                accountBalanceAlerts: true,
                suspiciousActivityAlerts: true,
                familyInvitations: true,
            },
            privacy: {
                shareSpendingWithFamily: true,
                shareGoalsWithFamily: true,
                allowFamilyToSeeTransactionDetails: false,
                showProfileToFamilyMembers: true,
                dataRetentionPeriod: 2555, // 7 years in days
                allowAnalytics: true,
                allowMarketingEmails: false,
            },
            display: {
                dateFormat: getDateFormatFromLocale(detectedLocale),
                timeFormat: getTimeFormatFromLocale(detectedLocale),
                numberFormat: getNumberFormatFromLocale(detectedLocale),
                showCentsInDisplays: true,
                defaultTransactionView: "list",
                chartPreferences: {
                    defaultChartType: "bar",
                    showGridLines: true,
                    animateCharts: true,
                    colorScheme: "default",
                },
                dashboardLayout: ["overview", "recent_transactions", "budgets", "goals"],
            },
            accessibility: {
                fontSize: "medium",
                highContrast: false,
                reduceMotion: false,
                screenReaderOptimized: false,
                voiceOverEnabled: false,
                hapticFeedback: true,
                longPressDelay: 500,
            },
            financial: {
                defaultTransactionCategory: types_1.TransactionCategory.OTHER_EXPENSE,
                autoCategorizationEnabled: true,
                roundUpSavings: false,
                budgetStartDay: 1,
                showNetWorth: true,
                hiddenAccounts: [],
                defaultBudgetAlertThreshold: 80,
                enableSpendingLimits: false,
            },
            security: {
                biometricAuthEnabled: false,
                pinAuthEnabled: false,
                autoLockTimeout: 15, // 15 minutes
                requireAuthForTransactions: false,
                requireAuthForBudgetChanges: true,
                requireAuthForGoalChanges: false,
                sessionTimeout: 60, // 1 hour
                allowedDevices: [],
                twoFactorAuthEnabled: false,
                suspiciousActivityDetection: true,
            },
        };
        const userData = {
            email: userRecord.email || "",
            displayName: userRecord.displayName || ((_a = userRecord.email) === null || _a === void 0 ? void 0 : _a.split("@")[0]) || "User",
            photoURL: userRecord.photoURL,
            role: types_1.UserRole.VIEWER, // Default role, will be updated when joining/creating family
            preferences: defaultPreferences,
            isActive: true,
        };
        // Create user document with custom ID (user's UID)
        await (0, firestore_1.createDocument)("users", userData, userRecord.uid);
        // Set custom claims for role-based access
        await (0, auth_1.setUserClaims)(userRecord.uid, {
            role: types_1.UserRole.VIEWER
        });
        // Log successful creation
        console.log(`Successfully created user profile for ${userRecord.uid} with preferences`);
        // Optionally trigger welcome email or onboarding flow
        // await triggerWelcomeEmail(userRecord.email, userData.displayName);
    }
    catch (error) {
        console.error(`Error creating user profile for ${userRecord.uid}:`, error);
        // Attempt to create a minimal user document if full creation fails
        try {
            const minimalUserData = {
                email: userRecord.email || "",
                displayName: userRecord.displayName || "User",
                role: types_1.UserRole.VIEWER,
                isActive: true,
                preferences: {
                    currency: "USD",
                    locale: "en-US",
                    theme: "auto",
                    notifications: { email: true, push: true, transactionAlerts: true, budgetAlerts: true, weeklyReports: false },
                },
            };
            await (0, firestore_1.createDocument)("users", minimalUserData, userRecord.uid);
            console.log(`Created minimal user profile for ${userRecord.uid} after failure`);
        }
        catch (fallbackError) {
            console.error(`Failed to create even minimal user profile for ${userRecord.uid}:`, fallbackError);
        }
    }
});
/**
 * Helper function to detect locale from provider data or use default
 */
function getLocaleFromProviderOrDefault(providerData) {
    // Try to detect from provider data (Google, Facebook, etc.)
    if (providerData === null || providerData === void 0 ? void 0 : providerData.locale) {
        return providerData.locale;
    }
    // Default to US locale
    return "en-US";
}
/**
 * Helper function to get currency from locale
 */
function getCurrencyFromLocale(locale) {
    const currencyMap = {
        "en-US": "USD",
        "en-GB": "GBP",
        "en-CA": "CAD",
        "en-AU": "AUD",
        "fr-FR": "EUR",
        "de-DE": "EUR",
        "es-ES": "EUR",
        "it-IT": "EUR",
        "ja-JP": "JPY",
        "ko-KR": "KRW",
        "zh-CN": "CNY",
        "pt-BR": "BRL",
        "ru-RU": "RUB",
        "hi-IN": "INR",
    };
    return currencyMap[locale] || "USD";
}
/**
 * Helper function to get date format from locale
 */
function getDateFormatFromLocale(locale) {
    const dateFormatMap = {
        "en-US": "MM/DD/YYYY",
        "en-CA": "YYYY-MM-DD",
        "en-GB": "DD/MM/YYYY",
        "en-AU": "DD/MM/YYYY",
        "fr-FR": "DD/MM/YYYY",
        "de-DE": "DD/MM/YYYY",
        "es-ES": "DD/MM/YYYY",
        "it-IT": "DD/MM/YYYY",
        "ja-JP": "YYYY-MM-DD",
        "ko-KR": "YYYY-MM-DD",
        "zh-CN": "YYYY-MM-DD",
    };
    return dateFormatMap[locale] || "MM/DD/YYYY";
}
/**
 * Helper function to get time format from locale
 */
function getTimeFormatFromLocale(locale) {
    const timeFormatMap = {
        "en-US": "12h",
        "en-CA": "12h",
        "en-GB": "24h",
        "en-AU": "12h",
        "fr-FR": "24h",
        "de-DE": "24h",
        "es-ES": "24h",
        "it-IT": "24h",
        "ja-JP": "24h",
        "ko-KR": "24h",
        "zh-CN": "24h",
    };
    return timeFormatMap[locale] || "12h";
}
/**
 * Helper function to get number format from locale
 */
function getNumberFormatFromLocale(locale) {
    const numberFormatMap = {
        "en-US": "US",
        "en-CA": "US",
        "en-GB": "EU",
        "en-AU": "US",
        "fr-FR": "EU",
        "de-DE": "EU",
        "es-ES": "EU",
        "it-IT": "EU",
        "hi-IN": "IN",
        "ja-JP": "US",
        "ko-KR": "US",
        "zh-CN": "US",
    };
    return numberFormatMap[locale] || "US";
}
//# sourceMappingURL=onUserCreate.js.map