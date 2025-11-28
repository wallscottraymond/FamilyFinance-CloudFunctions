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
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const firestore_2 = require("../../utils/firestore");
const auth_1 = require("../../utils/auth");
const preCreateUserPeriodSummaries_1 = require("../summaries/orchestration/preCreateUserPeriodSummaries");
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
        await (0, firestore_2.createDocument)("users", userData, userRecord.uid);
        // Set custom claims for role-based access
        await (0, auth_1.setUserClaims)(userRecord.uid, {
            role: types_1.UserRole.VIEWER
        });
        // Log successful creation
        console.log(`Successfully created user profile for ${userRecord.uid} with preferences`);
        // Pre-create 24 months of period summaries (12 backward, 12 forward)
        // This runs asynchronously to avoid blocking user account creation
        (0, preCreateUserPeriodSummaries_1.preCreateUserPeriodSummaries)(userRecord.uid).catch((error) => {
            console.error(`Error pre-creating summaries for ${userRecord.uid}:`, error);
            // Don't throw - user account creation was successful
        });
        // Create summary collections with properly typed example documents
        try {
            const db = admin.firestore();
            const now = firestore_1.Timestamp.now();
            const windowStart = firestore_1.Timestamp.fromDate(new Date(new Date().getFullYear() - 1, 0, 1));
            const windowEnd = firestore_1.Timestamp.fromDate(new Date(new Date().getFullYear() + 1, 11, 31));
            // Outflow Summary Example with sample periods
            const currentMonth = new Date();
            const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
            // Create period IDs for nested structure
            const currentPeriodId = `${currentMonth.getFullYear()}-M${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
            const nextPeriodId = `${nextMonth.getFullYear()}-M${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;
            const outflowSummaryExample = {
                ownerId: userRecord.uid,
                ownerType: 'user',
                periodType: 'MONTHLY',
                resourceType: 'outflow',
                windowStart,
                windowEnd,
                periods: {
                    [currentPeriodId]: [
                        {
                            periodId: `period_${currentPeriodId}_comcast`,
                            outflowId: "outflow_example_comcast",
                            groupId: `group_example_${currentMonth.getMonth() + 1}`,
                            merchant: "Comcast",
                            userCustomName: "Home Internet",
                            totalAmountDue: 89.99,
                            totalAmountPaid: 89.99,
                            totalAmountUnpaid: 0,
                            totalAmountWithheld: 89.99,
                            averageAmount: 89.99,
                            isDuePeriod: true,
                            duePeriodCount: 1,
                            statusCounts: {
                                PAID: 1,
                                PENDING: 0
                            },
                            paymentProgressPercentage: 100,
                            fullyPaidCount: 1,
                            unpaidCount: 0,
                            itemCount: 1
                        }
                    ],
                    [nextPeriodId]: [
                        {
                            periodId: `period_${nextPeriodId}_netflix`,
                            outflowId: "outflow_example_netflix",
                            groupId: `group_example_${nextMonth.getMonth() + 1}`,
                            merchant: "Netflix",
                            userCustomName: "Streaming Service",
                            totalAmountDue: 15.99,
                            totalAmountPaid: 0,
                            totalAmountUnpaid: 15.99,
                            totalAmountWithheld: 15.99,
                            averageAmount: 15.99,
                            isDuePeriod: false,
                            duePeriodCount: 1,
                            statusCounts: {
                                PENDING: 1
                            },
                            paymentProgressPercentage: 0,
                            fullyPaidCount: 0,
                            unpaidCount: 1,
                            itemCount: 1
                        }
                    ]
                },
                totalItemCount: 2,
                lastRecalculated: now,
                createdAt: now,
                updatedAt: now
            };
            // Budget Summary Example with sample periods
            const budgetSummaryExample = {
                ownerId: userRecord.uid,
                ownerType: 'user',
                periodType: 'MONTHLY',
                resourceType: 'budget',
                windowStart,
                windowEnd,
                periods: [
                    {
                        periodId: `${currentMonth.getFullYear()}-M${String(currentMonth.getMonth() + 1).padStart(2, '0')}`,
                        name: "Groceries Budget",
                        budgetedAmount: 500.00,
                        spentAmount: 342.50,
                        remainingAmount: 157.50,
                        percentageUsed: 68.5,
                        transactionCount: 12,
                        isOverBudget: false
                    },
                    {
                        periodId: `${nextMonth.getFullYear()}-M${String(nextMonth.getMonth() + 1).padStart(2, '0')}`,
                        name: "Dining Out Budget",
                        budgetedAmount: 200.00,
                        spentAmount: 0,
                        remainingAmount: 200.00,
                        percentageUsed: 0,
                        transactionCount: 0,
                        isOverBudget: false
                    }
                ],
                totalItemCount: 2,
                lastRecalculated: now,
                createdAt: now,
                updatedAt: now
            };
            // Income Summary Example with sample periods
            const incomeSummaryExample = {
                ownerId: userRecord.uid,
                ownerType: 'user',
                periodType: 'MONTHLY',
                resourceType: 'income',
                windowStart,
                windowEnd,
                periods: [
                    {
                        periodId: `${currentMonth.getFullYear()}-M${String(currentMonth.getMonth() + 1).padStart(2, '0')}`,
                        name: "Salary",
                        expectedAmount: 5000.00,
                        receivedAmount: 5000.00,
                        pendingAmount: 0,
                        transactionCount: 2,
                        sources: ["Employer ABC Inc"]
                    }
                ],
                totalItemCount: 1,
                lastRecalculated: now,
                createdAt: now,
                updatedAt: now
            };
            // Goal Summary Example with sample periods
            const goalSummaryExample = {
                ownerId: userRecord.uid,
                ownerType: 'user',
                periodType: 'MONTHLY',
                resourceType: 'goal',
                windowStart,
                windowEnd,
                periods: [
                    {
                        periodId: `${currentMonth.getFullYear()}-M${String(currentMonth.getMonth() + 1).padStart(2, '0')}`,
                        name: "Emergency Fund",
                        targetAmount: 10000.00,
                        currentAmount: 3500.00,
                        contributedThisPeriod: 500.00,
                        percentageComplete: 35.0,
                        isOnTrack: true
                    }
                ],
                totalItemCount: 1,
                lastRecalculated: now,
                createdAt: now,
                updatedAt: now
            };
            // Create 4 root-level collections with properly typed example documents
            await Promise.all([
                db.collection('outflow_summary').doc('example').set(outflowSummaryExample),
                db.collection('budget_summary').doc('example').set(budgetSummaryExample),
                db.collection('income_summary').doc('example').set(incomeSummaryExample),
                db.collection('goal_summary').doc('example').set(goalSummaryExample)
            ]);
            console.log(`✅ Created summary collections for user ${userRecord.uid}`);
        }
        catch (summaryError) {
            console.error(`⚠️ Error creating summary collections for ${userRecord.uid}:`, summaryError);
            // Don't throw - user creation was successful, summary creation is non-critical
        }
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
            await (0, firestore_2.createDocument)("users", minimalUserData, userRecord.uid);
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