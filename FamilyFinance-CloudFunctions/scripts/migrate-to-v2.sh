#!/bin/bash

# Script to migrate Firebase Functions from v1 to v2
# Note: Auth triggers (onUserCreate, onUserDelete) stay as v1 since v2 only has pre-action triggers

echo "🚀 Starting migration from v1 to v2 Functions..."

# List of HTTP functions to delete (keeping auth triggers as v1)
HTTP_FUNCTIONS=(
    "approveTransaction"
    "createBudget"
    "createFamily" 
    "createTransaction"
    "deleteBudget"
    "deleteTransaction"
    "deleteUser"
    "generateFamilyInvite"
    "getBudget"
    "getBudgetSummary"
    "getFamily"
    "getFamilyBudgets"
    "getFamilyTransactions"
    "getTransaction"
    "getUserBudgets"
    "getUserPermissions"
    "getUserProfile"
    "getUserStatistics"
    "getUserTransactions"
    "joinFamily"
    "leaveFamily"
    "refreshUserSession"
    "removeFamilyMember"
    "transferFamilyAdmin"
    "updateBudget"
    "updateFamily"
    "updateNotificationPreferences"
    "updateTransaction"
    "updateUserProfile"
    "updateUserRole"
    "validateToken"
)

echo "🗑️  Deleting existing v1 HTTP functions..."

for func in "${HTTP_FUNCTIONS[@]}"; do
    echo "Deleting $func..."
    firebase functions:delete "$func" --force
done

echo "✅ v1 HTTP functions deleted successfully!"
echo "📦 Deploying v2 functions..."

# Deploy the new v2 functions
firebase deploy --only functions

echo "🎉 Migration complete!"
echo "📊 Auth triggers (onUserCreate, onUserDelete) remain as v1 (required for post-action)"
echo "🔄 All HTTP functions are now v2 with enhanced performance and features"