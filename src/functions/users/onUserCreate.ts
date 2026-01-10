import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import {
  User,
  UserRole,
  UserPreferences,
  NotificationSettings,
  PrivacySettings,
  DisplaySettings,
  AccessibilitySettings,
  FinancialSettings,
  SecuritySettings,
  ChartPreferences,
  TransactionCategory
} from "../../types";
import {
  createDocument
} from "../../utils/firestore";
import {
  setUserClaims
} from "../../utils/auth";
import { preCreateUserPeriodSummaries } from "../summaries/orchestration/preCreateUserPeriodSummaries";
import { createEverythingElseBudget } from "../budgets/utils/createEverythingElseBudget";

/**
 * Create user profile (triggered on user registration)
 * This function automatically creates a comprehensive user document in Firestore
 * when a new user registers via Firebase Authentication
 */
export const onUserCreate = functions.region("us-central1").runWith({
  memory: "512MB",
  timeoutSeconds: 60
}).auth.user().onCreate(async (userRecord) => {
  try {
    // Get user's locale and timezone from provider data if available
    const providerData = userRecord.providerData[0];
    const detectedLocale = getLocaleFromProviderOrDefault(providerData);
    const detectedCurrency = getCurrencyFromLocale(detectedLocale);

    // Create comprehensive default preferences
    const defaultPreferences: UserPreferences = {
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
      } as NotificationSettings,
      privacy: {
        shareSpendingWithFamily: true,
        shareGoalsWithFamily: true,
        allowFamilyToSeeTransactionDetails: false,
        showProfileToFamilyMembers: true,
        dataRetentionPeriod: 2555, // 7 years in days
        allowAnalytics: true,
        allowMarketingEmails: false,
      } as PrivacySettings,
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
        } as ChartPreferences,
        dashboardLayout: ["overview", "recent_transactions", "budgets", "goals"],
      } as DisplaySettings,
      accessibility: {
        fontSize: "medium",
        highContrast: false,
        reduceMotion: false,
        screenReaderOptimized: false,
        voiceOverEnabled: false,
        hapticFeedback: true,
        longPressDelay: 500,
      } as AccessibilitySettings,
      financial: {
        defaultTransactionCategory: TransactionCategory.OTHER_EXPENSE,
        autoCategorizationEnabled: true,
        roundUpSavings: false,
        budgetStartDay: 1,
        showNetWorth: true,
        hiddenAccounts: [],
        defaultBudgetAlertThreshold: 80,
        enableSpendingLimits: false,
      } as FinancialSettings,
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
      } as SecuritySettings,
    };

    const userData: Omit<User, "id" | "createdAt" | "updatedAt"> = {
      email: userRecord.email || "",
      displayName: userRecord.displayName || userRecord.email?.split("@")[0] || "User",
      photoURL: userRecord.photoURL,
      role: UserRole.EDITOR, // Default role - allows users to create budgets/transactions
      preferences: defaultPreferences,
      isActive: true,
    };

    // Create user document with custom ID (user's UID)
    await createDocument<User>("users", userData, userRecord.uid);

    // Set custom claims for role-based access
    await setUserClaims(userRecord.uid, {
      role: UserRole.EDITOR
    });

    // Log successful creation
    console.log(`Successfully created user profile for ${userRecord.uid} with preferences`);

    // Pre-create 24 months of period summaries (12 backward, 12 forward)
    // This runs asynchronously to avoid blocking user account creation
    preCreateUserPeriodSummaries(userRecord.uid).catch((error) => {
      console.error(`Error pre-creating summaries for ${userRecord.uid}:`, error);
      // Don't throw - user account creation was successful
    });

    // Create "everything else" system budget (catch-all for unassigned transactions)
    // This runs asynchronously to avoid blocking user account creation
    const db = admin.firestore();
    createEverythingElseBudget(db, userRecord.uid, detectedCurrency).then((budgetId) => {
      console.log(`✅ Created "everything else" budget for user ${userRecord.uid}: ${budgetId}`);
    }).catch((error) => {
      console.error(`❌ Failed to create "everything else" budget for user ${userRecord.uid}:`, error);
      // Don't throw - user account creation was successful
    });

    // Create summary collections with properly typed example documents
    try {
      const db = admin.firestore();
      const now = Timestamp.now();
      const windowStart = Timestamp.fromDate(new Date(new Date().getFullYear() - 1, 0, 1));
      const windowEnd = Timestamp.fromDate(new Date(new Date().getFullYear() + 1, 11, 31));

      // Outflow Summary Example with sample periods
      const currentMonth = new Date();
      const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);

      // Create period IDs for nested structure
      const currentPeriodId = `${currentMonth.getFullYear()}-M${String(currentMonth.getMonth() + 1).padStart(2, '0')}`;
      const nextPeriodId = `${nextMonth.getFullYear()}-M${String(nextMonth.getMonth() + 1).padStart(2, '0')}`;

      const outflowSummaryExample = {
        ownerId: userRecord.uid,
        ownerType: 'user' as const,
        periodType: 'MONTHLY' as const,
        resourceType: 'outflow' as const,
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
        ownerType: 'user' as const,
        periodType: 'MONTHLY' as const,
        resourceType: 'budget' as const,
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
        ownerType: 'user' as const,
        periodType: 'MONTHLY' as const,
        resourceType: 'income' as const,
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
        ownerType: 'user' as const,
        periodType: 'MONTHLY' as const,
        resourceType: 'goal' as const,
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
    } catch (summaryError) {
      console.error(`⚠️ Error creating summary collections for ${userRecord.uid}:`, summaryError);
      // Don't throw - user creation was successful, summary creation is non-critical
    }

    // Optionally trigger welcome email or onboarding flow
    // await triggerWelcomeEmail(userRecord.email, userData.displayName);
    
  } catch (error) {
    console.error(`Error creating user profile for ${userRecord.uid}:`, error);
    
    // Attempt to create a minimal user document if full creation fails
    try {
      const minimalUserData = {
        email: userRecord.email || "",
        displayName: userRecord.displayName || "User",
        role: UserRole.VIEWER,
        isActive: true,
        preferences: {
          currency: "USD",
          locale: "en-US",
          theme: "auto",
          notifications: { email: true, push: true, transactionAlerts: true, budgetAlerts: true, weeklyReports: false },
        },
      };
      
      await createDocument("users", minimalUserData, userRecord.uid);
      console.log(`Created minimal user profile for ${userRecord.uid} after failure`);
      
    } catch (fallbackError) {
      console.error(`Failed to create even minimal user profile for ${userRecord.uid}:`, fallbackError);
    }
  }
});

/**
 * Helper function to detect locale from provider data or use default
 */
function getLocaleFromProviderOrDefault(providerData?: any): string {
  // Try to detect from provider data (Google, Facebook, etc.)
  if (providerData?.locale) {
    return providerData.locale;
  }
  
  // Default to US locale
  return "en-US";
}

/**
 * Helper function to get currency from locale
 */
function getCurrencyFromLocale(locale: string): string {
  const currencyMap: Record<string, string> = {
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
function getDateFormatFromLocale(locale: string): "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD" {
  const dateFormatMap: Record<string, "MM/DD/YYYY" | "DD/MM/YYYY" | "YYYY-MM-DD"> = {
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
function getTimeFormatFromLocale(locale: string): "12h" | "24h" {
  const timeFormatMap: Record<string, "12h" | "24h"> = {
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
function getNumberFormatFromLocale(locale: string): "US" | "EU" | "IN" {
  const numberFormatMap: Record<string, "US" | "EU" | "IN"> = {
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