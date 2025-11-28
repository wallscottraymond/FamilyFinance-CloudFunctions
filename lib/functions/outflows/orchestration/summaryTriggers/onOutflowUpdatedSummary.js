"use strict";
/**
 * Outflow Summary Update on Outflow Name Changes
 *
 * This trigger updates all affected outflow summaries when an outflow's
 * merchantName or userCustomName changes. It ensures denormalized names
 * stay in sync across all period entries.
 *
 * Memory: 512MiB, Timeout: 60s (higher limits due to potentially updating multiple summaries)
 */
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
exports.onOutflowUpdatedSummary = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const batchUpdateSummary_1 = require("../../utils/summaryOperations/batchUpdateSummary");
/**
 * Triggered when an outflow is updated
 * Updates all affected summaries if merchantName or userCustomName changed
 */
exports.onOutflowUpdatedSummary = (0, firestore_1.onDocumentUpdated)({
    document: 'outflows/{outflowId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b;
    try {
        const outflowId = event.params.outflowId;
        const beforeData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
        const afterData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
        if (!afterData) {
            console.error('[onOutflowUpdatedSummary] No after data found');
            return;
        }
        // Check if name fields changed
        const merchantChanged = beforeData.merchantName !== afterData.merchantName;
        const userCustomNameChanged = beforeData.userCustomName !== afterData.userCustomName;
        const descriptionChanged = beforeData.description !== afterData.description;
        if (!merchantChanged && !userCustomNameChanged && !descriptionChanged) {
            console.log(`[onOutflowUpdatedSummary] No name changes for outflow ${outflowId}, skipping`);
            return;
        }
        console.log('');
        console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
        console.log('[onOutflowUpdatedSummary] UPDATING OUTFLOW NAMES IN SUMMARIES');
        console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
        console.log(`[onOutflowUpdatedSummary] Outflow ID: ${outflowId}`);
        console.log(`[onOutflowUpdatedSummary] Old Merchant: ${beforeData.merchantName}`);
        console.log(`[onOutflowUpdatedSummary] New Merchant: ${afterData.merchantName}`);
        console.log(`[onOutflowUpdatedSummary] Old Custom Name: ${beforeData.userCustomName}`);
        console.log(`[onOutflowUpdatedSummary] New Custom Name: ${afterData.userCustomName}`);
        console.log('');
        const db = admin.firestore();
        // Step 1: Find all affected summaries by querying outflow_periods
        console.log('[onOutflowUpdatedSummary] Finding affected summaries...');
        const periodsQuery = await db.collection('outflow_periods')
            .where('outflowId', '==', outflowId)
            .where('isActive', '==', true)
            .limit(100) // Safety limit
            .get();
        if (periodsQuery.empty) {
            console.log('[onOutflowUpdatedSummary] No active periods found for this outflow');
            console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
            console.log('');
            return;
        }
        console.log(`[onOutflowUpdatedSummary] Found ${periodsQuery.size} active periods`);
        const summariesToUpdate = new Map();
        periodsQuery.forEach(doc => {
            const period = doc.data();
            const periodType = determinePeriodType(period.sourcePeriodId);
            // Add user summary
            const userKey = `${period.ownerId}_user_${periodType}`;
            if (!summariesToUpdate.has(userKey)) {
                summariesToUpdate.set(userKey, {
                    ownerId: period.ownerId,
                    ownerType: 'user',
                    periodType
                });
            }
            // Add group summary if applicable
            if (period.groupId) {
                const groupKey = `${period.groupId}_group_${periodType}`;
                if (!summariesToUpdate.has(groupKey)) {
                    summariesToUpdate.set(groupKey, {
                        ownerId: period.groupId,
                        ownerType: 'group',
                        periodType
                    });
                }
            }
        });
        console.log(`[onOutflowUpdatedSummary] Found ${summariesToUpdate.size} unique summaries to update`);
        // Step 3: Update each affected summary
        const merchant = afterData.merchantName || afterData.description || 'Unknown';
        const userCustomName = afterData.userCustomName || afterData.merchantName || afterData.description || 'Unknown';
        for (const [key, summaryKey] of summariesToUpdate.entries()) {
            try {
                const summaryId = (0, batchUpdateSummary_1.getSummaryId)(summaryKey.ownerId, summaryKey.ownerType, summaryKey.periodType);
                console.log(`[onOutflowUpdatedSummary] Updating summary: ${summaryId}`);
                await (0, batchUpdateSummary_1.batchUpdateSummary)({
                    summaryId,
                    operations: [{
                            type: 'updateNames',
                            data: {
                                outflowId,
                                merchant,
                                userCustomName
                            }
                        }]
                });
                console.log(`[onOutflowUpdatedSummary] ✓ Summary ${summaryId} updated`);
            }
            catch (error) {
                console.error(`[onOutflowUpdatedSummary] ❌ Error updating ${key}:`, error);
                // Continue with other summaries even if one fails
            }
        }
        console.log('[onOutflowUpdatedSummary] ════════════════════════════════════════════');
        console.log('');
    }
    catch (error) {
        console.error('');
        console.error('[onOutflowUpdatedSummary] ❌ ERROR:', error);
        console.error('');
        // Don't throw - summary update failures shouldn't break outflow updates
    }
});
/**
 * Determine PeriodType from sourcePeriodId format
 */
function determinePeriodType(sourcePeriodId) {
    const { PeriodType } = require('../../../../types');
    if (sourcePeriodId.includes('-M') && !sourcePeriodId.includes('-BM')) {
        return PeriodType.MONTHLY;
    }
    else if (sourcePeriodId.includes('-BM')) {
        return PeriodType.BI_MONTHLY;
    }
    else if (sourcePeriodId.includes('-W')) {
        return PeriodType.WEEKLY;
    }
    return PeriodType.MONTHLY;
}
//# sourceMappingURL=onOutflowUpdatedSummary.js.map