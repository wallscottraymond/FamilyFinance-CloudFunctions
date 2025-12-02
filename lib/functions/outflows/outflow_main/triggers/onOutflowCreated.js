"use strict";
/**
 * Outflow Periods Auto-Generation Trigger
 *
 * This Cloud Function automatically creates outflow_periods when an outflow is created.
 * It is a pure orchestration trigger that delegates all business logic to utility functions.
 *
 * Memory: 512MiB, Timeout: 60s
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
exports.onOutflowCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const outflowPeriods_1 = require("../../utils/outflowPeriods");
const batchUpdateUserPeriodSummaries_1 = require("../../../summaries/utils/batchUpdateUserPeriodSummaries");
/**
 * Triggered when an outflow is created
 * Automatically generates outflow_periods for all active source periods
 */
exports.onOutflowCreated = (0, firestore_1.onDocumentCreated)({
    document: 'outflows/{outflowId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b;
    console.log('');
    console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
    console.log('🔥 TRIGGER FIRED: onOutflowCreated');
    console.log('🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥');
    console.log('');
    try {
        const outflowId = event.params.outflowId;
        console.log(`[onOutflowCreated] Extracting outflow ID: ${outflowId}`);
        const outflowData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
        if (!outflowData) {
            console.error('');
            console.error('❌ ERROR: No outflow data found in event');
            console.error(`   Event params:`, event.params);
            console.error(`   Event data exists: ${!!event.data}`);
            return;
        }
        console.log(`[onOutflowCreated] ✓ Outflow data extracted successfully`);
        console.log(`[onOutflowCreated] Outflow Details:`);
        console.log(`  - ID: ${outflowId}`);
        console.log(`  - Description: ${outflowData.description}`);
        console.log(`  - Amount: $${outflowData.averageAmount}`);
        console.log(`  - Frequency: ${outflowData.frequency}`);
        console.log(`  - First Date: ${(_b = outflowData.firstDate) === null || _b === void 0 ? void 0 : _b.toDate().toISOString()}`);
        console.log(`  - Is Active: ${outflowData.isActive}`);
        console.log(`  - User ID: ${outflowData.ownerId}`);
        // Skip inactive outflows
        if (!outflowData.isActive) {
            console.log('');
            console.log('⏭️  SKIPPING: Outflow is inactive');
            console.log(`   Outflow ID: ${outflowId}`);
            return;
        }
        console.log('');
        console.log('[onOutflowCreated] ✓ Outflow is ACTIVE - proceeding with period generation');
        const db = admin.firestore();
        // Calculate time range for period generation using utility function
        console.log('');
        console.log('[onOutflowCreated] STEP 1: Calculate period generation range');
        const { startDate, endDate } = (0, outflowPeriods_1.calculatePeriodGenerationRange)(outflowData, 15);
        console.log(`  - Start Date: ${startDate.toISOString()} (from outflow.firstDate)`);
        console.log(`  - End Date: ${endDate.toISOString()} (15 months forward from now)`);
        console.log(`  - Total span: ${Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))} days`);
        // Create outflow periods using utility function
        console.log('');
        console.log('[onOutflowCreated] STEP 2: Calling createOutflowPeriodsFromSource...');
        console.log(`  - Outflow ID: ${outflowId}`);
        console.log(`  - Outflow Description: ${outflowData.description}`);
        console.log(`  - Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        const result = await (0, outflowPeriods_1.createOutflowPeriodsFromSource)(db, outflowId, outflowData, startDate, endDate);
        console.log('');
        console.log('[onOutflowCreated] STEP 3: Period creation completed');
        console.log(`  ✓ Periods Created: ${result.periodsCreated}`);
        console.log(`  ✓ Period IDs: ${result.periodIds.join(', ')}`);
        // STEP 4: Batch update user period summaries
        if (outflowData.ownerId && result.periodIds.length > 0) {
            console.log('');
            console.log('[onOutflowCreated] STEP 4: Batch updating user period summaries');
            console.log(`  - Updating summaries for ${result.periodIds.length} periods`);
            console.log(`  - User ID: ${outflowData.ownerId}`);
            try {
                const summariesUpdated = await (0, batchUpdateUserPeriodSummaries_1.batchUpdateUserPeriodSummariesFromOutflowPeriods)(outflowData.ownerId, result.periodIds);
                console.log('');
                console.log('[onOutflowCreated] ✓ Batch summary update completed');
                console.log(`  ✓ Summaries Updated: ${summariesUpdated}`);
            }
            catch (summaryError) {
                console.error('');
                console.error('[onOutflowCreated] ⚠️  Error updating summaries (non-fatal):');
                console.error(summaryError);
                console.log('[onOutflowCreated] Continuing despite summary update error...');
            }
        }
        console.log('');
        console.log('[onOutflowCreated] ℹ️  Auto-matching will happen per-period via onOutflowPeriodCreate triggers');
        console.log('[onOutflowCreated] Each period will independently match its transactions when created');
    }
    catch (error) {
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ TRIGGER ERROR in onOutflowCreated');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('[onOutflowCreated] Error details:', error);
        if (error instanceof Error) {
            console.error(`  - Message: ${error.message}`);
            console.error(`  - Stack: ${error.stack}`);
        }
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        // Don't throw - we don't want to break outflow creation if period generation fails
    }
});
//# sourceMappingURL=onOutflowCreated.js.map