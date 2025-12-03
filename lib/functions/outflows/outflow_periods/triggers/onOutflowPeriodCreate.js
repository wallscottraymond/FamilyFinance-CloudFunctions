"use strict";
/**
 * Outflow Period Post-Creation Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is created.
 * It automatically matches historical transactions to this period and
 * updates the period's payment status.
 *
 * Memory: 256MiB, Timeout: 30s
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
exports.onOutflowPeriodCreate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const autoMatchSinglePeriod_1 = require("../utils/autoMatchSinglePeriod");
const createOutflowPeriodSummary_1 = require("../../outflow_summaries/crud/createOutflowPeriodSummary");
/**
 * Triggered when an outflow_period is created
 * Auto-matches transactions to this specific period
 */
exports.onOutflowPeriodCreate = (0, firestore_1.onDocumentCreated)({
    document: 'outflow_periods/{outflowPeriodId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (event) => {
    var _a, _b, _c, _d;
    try {
        const outflowPeriodId = event.params.outflowPeriodId;
        const outflowPeriodData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
        if (!outflowPeriodData) {
            console.error('[onOutflowPeriodCreate] No outflow period data found');
            return;
        }
        console.log('');
        console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
        console.log('[onOutflowPeriodCreate] NEW OUTFLOW PERIOD CREATED');
        console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
        console.log(`[onOutflowPeriodCreate] Period ID: ${outflowPeriodId}`);
        console.log(`[onOutflowPeriodCreate] Description: ${outflowPeriodData.description}`);
        console.log(`[onOutflowPeriodCreate] Period Type: ${outflowPeriodData.periodType}`);
        console.log(`[onOutflowPeriodCreate] Source Period: ${outflowPeriodData.sourcePeriodId}`);
        console.log(`[onOutflowPeriodCreate] Period Range: ${(_b = outflowPeriodData.periodStartDate) === null || _b === void 0 ? void 0 : _b.toDate().toISOString().split('T')[0]} to ${(_c = outflowPeriodData.periodEndDate) === null || _c === void 0 ? void 0 : _c.toDate().toISOString().split('T')[0]}`);
        console.log(`[onOutflowPeriodCreate] Expected Amount: $${outflowPeriodData.expectedAmount || outflowPeriodData.amountWithheld}`);
        console.log('');
        const db = admin.firestore();
        // Step 1: Get parent outflow
        console.log('[onOutflowPeriodCreate] Step 1: Fetching parent outflow...');
        const outflowRef = db.collection('outflows').doc(outflowPeriodData.outflowId);
        const outflowSnap = await outflowRef.get();
        if (!outflowSnap.exists) {
            console.error(`[onOutflowPeriodCreate] Parent outflow not found: ${outflowPeriodData.outflowId}`);
            return;
        }
        const outflow = Object.assign({ id: outflowSnap.id }, outflowSnap.data());
        console.log(`[onOutflowPeriodCreate] ✓ Found parent outflow: ${outflow.description}`);
        console.log(`[onOutflowPeriodCreate] ✓ Transaction IDs in outflow: ${((_d = outflow.transactionIds) === null || _d === void 0 ? void 0 : _d.length) || 0}`);
        console.log('');
        // Step 2: Auto-match transactions for this specific period
        const transactionIds = outflow.transactionIds || [];
        if (transactionIds.length === 0) {
            console.log('[onOutflowPeriodCreate] No historical transactions to match (transactionIds empty)');
            console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
            console.log('');
            return;
        }
        console.log('[onOutflowPeriodCreate] Step 2: Auto-matching transactions to this period...');
        const result = await (0, autoMatchSinglePeriod_1.autoMatchSinglePeriod)(db, outflowPeriodId, outflowPeriodData, outflow);
        console.log('');
        console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
        console.log('[onOutflowPeriodCreate] AUTO-MATCH COMPLETE');
        console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
        console.log(`[onOutflowPeriodCreate] ✓ Transactions matched: ${result.transactionsMatched}`);
        console.log(`[onOutflowPeriodCreate] ✓ Splits assigned: ${result.splitsAssigned}`);
        console.log(`[onOutflowPeriodCreate] ✓ Period updated: ${result.periodUpdated ? 'Yes' : 'No'}`);
        console.log(`[onOutflowPeriodCreate] ✓ Final status: ${result.finalStatus || 'N/A'}`);
        if (result.errors.length > 0) {
            console.log(`[onOutflowPeriodCreate] ⚠️  Errors: ${result.errors.length}`);
            result.errors.forEach(err => console.log(`[onOutflowPeriodCreate]    - ${err}`));
        }
        console.log('[onOutflowPeriodCreate] ════════════════════════════════════════════');
        console.log('');
        // Step 3: Update outflow summaries (FINAL STEP - non-critical)
        console.log('[onOutflowPeriodCreate] Step 3: Updating outflow summaries...');
        try {
            await (0, createOutflowPeriodSummary_1.createOutflowPeriodSummary)(outflowPeriodData, outflowPeriodId);
            console.log('[onOutflowPeriodCreate] ✓ Summaries updated successfully');
        }
        catch (summaryError) {
            console.error('[onOutflowPeriodCreate] ⚠️  Summary update failed:', summaryError);
            // Don't throw - summary failures shouldn't break the trigger
            // Summaries can be recalculated via manual API call if needed
        }
    }
    catch (error) {
        console.error('');
        console.error('[onOutflowPeriodCreate] ❌ ERROR:', error);
        console.error('');
        // Don't throw - we don't want to break period creation if auto-matching fails
    }
});
//# sourceMappingURL=onOutflowPeriodCreate.js.map