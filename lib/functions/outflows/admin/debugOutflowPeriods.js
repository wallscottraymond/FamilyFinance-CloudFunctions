"use strict";
/**
 * Debug Outflow Periods - Admin Function
 * Query outflow_periods collection to see what data exists
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugOutflowPeriods = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const app_1 = require("firebase-admin/app");
// Initialize Firebase Admin if not already initialized
if ((0, app_1.getApps)().length === 0) {
    (0, app_1.initializeApp)();
}
const db = (0, firestore_1.getFirestore)();
exports.debugOutflowPeriods = (0, https_1.onRequest)({
    cors: true,
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (req, res) => {
    try {
        console.log('🔍 Debugging outflow_periods collection...');
        // Query all outflow periods (limit 30 to show more results)
        const outflowPeriodsSnapshot = await db.collection('outflow_periods')
            .limit(30)
            .get();
        const results = {
            total: outflowPeriodsSnapshot.size,
            periods: [],
            users: new Set(),
            currentPeriods: [],
        };
        const now = new Date();
        console.log(`Current time: ${now.toISOString()}`);
        outflowPeriodsSnapshot.docs.forEach(doc => {
            var _a, _b;
            const data = doc.data();
            const periodStart = (_a = data.periodStartDate) === null || _a === void 0 ? void 0 : _a.toDate();
            const periodEnd = (_b = data.periodEndDate) === null || _b === void 0 ? void 0 : _b.toDate();
            results.users.add(data.userId);
            const periodInfo = {
                id: doc.id,
                userId: data.userId,
                outflowId: data.outflowId,
                billAmount: data.billAmount,
                periodStartDate: periodStart === null || periodStart === void 0 ? void 0 : periodStart.toISOString(),
                periodEndDate: periodEnd === null || periodEnd === void 0 ? void 0 : periodEnd.toISOString(),
                isDuePeriod: data.isDuePeriod,
                isActive: data.isActive,
                isCurrent: periodStart && periodEnd && periodStart <= now && periodEnd >= now,
                // Show the critical fields for subscription queries
                periodId: data.periodId,
                sourcePeriodId: data.sourcePeriodId,
                hasFields: {
                    periodId: data.periodId !== undefined,
                    sourcePeriodId: data.sourcePeriodId !== undefined,
                    userId: data.userId !== undefined,
                    isActive: data.isActive !== undefined,
                }
            };
            results.periods.push(periodInfo);
            if (periodInfo.isCurrent) {
                results.currentPeriods.push(periodInfo);
            }
        });
        console.log(`Found ${results.total} outflow periods for ${results.users.size} users`);
        console.log(`Current periods: ${results.currentPeriods.length}`);
        console.log('Users:', Array.from(results.users));
        // Also query specifically for the current user  
        const currentUserId = 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1';
        const currentUserSnapshot = await db.collection('outflow_periods')
            .where('userId', '==', currentUserId)
            .get();
        console.log(`Found ${currentUserSnapshot.size} outflow periods for current user: ${currentUserId}`);
        const currentUserResults = {
            userId: currentUserId,
            count: currentUserSnapshot.size,
            periods: []
        };
        currentUserSnapshot.docs.forEach(doc => {
            const data = doc.data();
            currentUserResults.periods.push({
                id: doc.id,
                periodId: data.periodId,
                sourcePeriodId: data.sourcePeriodId,
                billAmount: data.billAmount,
                outflowId: data.outflowId,
                description: data.outflowDescription || 'N/A'
            });
        });
        res.status(200).json({
            success: true,
            data: Object.assign(Object.assign({}, results), { users: Array.from(results.users), // Convert Set to Array for JSON
                currentUserResults })
        });
    }
    catch (error) {
        console.error('Error debugging outflow periods:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
//# sourceMappingURL=debugOutflowPeriods.js.map