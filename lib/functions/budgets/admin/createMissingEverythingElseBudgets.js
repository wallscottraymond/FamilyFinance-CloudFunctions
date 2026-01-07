"use strict";
/**
 * Admin function to create "everything else" budgets for existing users
 *
 * This migration function backfills "everything else" budgets for users
 * who were created before the feature was implemented.
 *
 * Usage: firebase functions:call createMissingEverythingElseBudgets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMissingEverythingElseBudgets = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const index_1 = require("../../../index");
const createEverythingElseBudget_1 = require("../utils/createEverythingElseBudget");
/**
 * Create "everything else" budgets for existing users
 *
 * Admin-only callable function that:
 * 1. Queries all active users
 * 2. Checks if each user already has an "everything else" budget
 * 3. Creates the budget if missing
 * 4. Returns summary statistics
 *
 * @param request - Callable function request
 * @returns Migration summary with created/skipped/error counts
 */
exports.createMissingEverythingElseBudgets = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 540, // 9 minutes for large migrations
}, async (request) => {
    var _a, _b;
    console.log('🔧 [createMissingEverythingElseBudgets] Migration started');
    // 1. Authentication check
    if (!request.auth) {
        console.error('❌ [createMissingEverythingElseBudgets] Unauthenticated request');
        throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
    }
    // 2. Admin role check
    const isAdmin = ((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.role) === 'admin';
    if (!isAdmin) {
        console.error(`❌ [createMissingEverythingElseBudgets] Non-admin user attempted migration: ${request.auth.uid}`);
        throw new https_1.HttpsError('permission-denied', 'Only admins can run migration functions');
    }
    console.log(`✅ [createMissingEverythingElseBudgets] Admin verified: ${request.auth.uid}`);
    try {
        // 3. Query all active users
        console.log('📊 [createMissingEverythingElseBudgets] Querying active users...');
        const usersSnapshot = await index_1.db.collection('users')
            .where('isActive', '==', true)
            .get();
        if (usersSnapshot.empty) {
            console.warn('⚠️ [createMissingEverythingElseBudgets] No active users found');
            return {
                success: true,
                summary: {
                    totalUsers: 0,
                    budgetsCreated: 0,
                    budgetsSkipped: 0,
                    errors: 0,
                    timestamp: firestore_1.Timestamp.now()
                }
            };
        }
        console.log(`📋 [createMissingEverythingElseBudgets] Found ${usersSnapshot.docs.length} active users`);
        // 4. Initialize counters
        let budgetsCreated = 0;
        let budgetsSkipped = 0;
        let errorCount = 0;
        const errorDetails = [];
        // 5. Process each user
        for (let i = 0; i < usersSnapshot.docs.length; i++) {
            const userDoc = usersSnapshot.docs[i];
            const userId = userDoc.id;
            const userData = userDoc.data();
            // Log progress every 10 users
            if ((i + 1) % 10 === 0) {
                const progressPercentage = ((i + 1) / usersSnapshot.docs.length * 100).toFixed(1);
                console.log(`📈 [createMissingEverythingElseBudgets] Progress: ${i + 1}/${usersSnapshot.docs.length} (${progressPercentage}%)`);
            }
            try {
                // 6. Check if user already has "everything else" budget
                const existingBudgetQuery = await index_1.db.collection('budgets')
                    .where('userId', '==', userId)
                    .where('isSystemEverythingElse', '==', true)
                    .get();
                if (!existingBudgetQuery.empty) {
                    // User already has the budget - skip
                    console.log(`⏭️ [createMissingEverythingElseBudgets] User ${userId} already has "everything else" budget`);
                    budgetsSkipped++;
                    continue;
                }
                // 7. Create "everything else" budget for user
                const userCurrency = ((_b = userData.preferences) === null || _b === void 0 ? void 0 : _b.currency) || 'USD';
                const budgetId = await (0, createEverythingElseBudget_1.createEverythingElseBudget)(index_1.db, userId, userCurrency);
                console.log(`✅ [createMissingEverythingElseBudgets] Created "everything else" budget for user ${userId}: ${budgetId}`);
                budgetsCreated++;
            }
            catch (error) {
                // 8. Handle individual user error - continue processing other users
                console.error(`❌ [createMissingEverythingElseBudgets] Error processing user ${userId}:`, error);
                errorCount++;
                errorDetails.push({
                    userId,
                    error: error.message || 'Unknown error'
                });
            }
        }
        // 9. Return summary
        const summary = {
            totalUsers: usersSnapshot.docs.length,
            budgetsCreated,
            budgetsSkipped,
            errors: errorCount,
            timestamp: firestore_1.Timestamp.now()
        };
        console.log('🎉 [createMissingEverythingElseBudgets] Migration completed:', summary);
        return {
            success: true,
            summary,
            errorDetails: errorDetails.length > 0 ? errorDetails : undefined
        };
    }
    catch (error) {
        // 10. Handle complete failure
        console.error('❌ [createMissingEverythingElseBudgets] Migration failed:', error);
        return {
            success: false,
            error: {
                code: 'migration-failed',
                message: error.message || 'Failed to complete migration'
            }
        };
    }
});
//# sourceMappingURL=createMissingEverythingElseBudgets.js.map