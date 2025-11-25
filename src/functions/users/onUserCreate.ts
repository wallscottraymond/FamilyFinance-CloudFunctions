import * as functions from "firebase-functions";
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
      role: UserRole.VIEWER, // Default role, will be updated when joining/creating family
      preferences: defaultPreferences,
      isActive: true,
    };

    // Create user document with custom ID (user's UID)
    await createDocument<User>("users", userData, userRecord.uid);

    // Set custom claims for role-based access
    await setUserClaims(userRecord.uid, { 
      role: UserRole.VIEWER
    });

    // Log successful creation
    console.log(`Successfully created user profile for ${userRecord.uid} with preferences`);
    
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