"use strict";
/**
 * Outflow Update Orchestration
 *
 * Automatically updates outflow periods when parent outflow changes from:
 * - Plaid webhook updates (amount changes, new transactions)
 * - Manual user edits (custom name changes)
 *
 * Updates: Future unpaid periods only (preserves payment history)
 *
 * Triggers on changes to:
 * - averageAmount: Recalculates period withholding amounts
 * - userCustomName: Updates period descriptions
 * - transactionIds: Re-runs auto-matching for transaction assignments
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
exports.onOutflowUpdated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const runUpdateOutflowPeriods_1 = require("../../outflow_periods/utils/runUpdateOutflowPeriods");
/**
 * Triggered when an outflow is updated
 * Automatically updates unpaid outflow_periods when relevant fields change
 */
exports.onOutflowUpdated = (0, firestore_1.onDocumentUpdated)({
    document: 'outflows/{outflowId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b;
    try {
        const outflowId = event.params.outflowId;
        const outflowBefore = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
        const outflowAfter = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
        if (!outflowBefore || !outflowAfter) {
            console.error('[onOutflowUpdated] Missing before/after data');
            return;
        }
        console.log('');
        console.log('[onOutflowUpdated] ════════════════════════════════════════════');
        console.log('[onOutflowUpdated] OUTFLOW UPDATED');
        console.log('[onOutflowUpdated] ════════════════════════════════════════════');
        console.log(`[onOutflowUpdated] Outflow ID: ${outflowId}`);
        console.log(`[onOutflowUpdated] Description: ${outflowAfter.description}`);
        console.log(`[onOutflowUpdated] Merchant: ${outflowAfter.merchantName}`);
        console.log('');
        const db = admin.firestore();
        // Run update orchestration
        console.log('[onOutflowUpdated] Calling runUpdateOutflowPeriods...');
        const result = await (0, runUpdateOutflowPeriods_1.runUpdateOutflowPeriods)(db, outflowId, outflowBefore, outflowAfter);
        console.log('');
        console.log('[onOutflowUpdated] ════════════════════════════════════════════');
        console.log('[onOutflowUpdated] UPDATE COMPLETE');
        console.log('[onOutflowUpdated] ════════════════════════════════════════════');
        if (result.fieldsUpdated.length === 0) {
            console.log(`[onOutflowUpdated] No relevant changes detected`);
        }
        else {
            console.log(`[onOutflowUpdated] ✓ Fields changed: ${result.fieldsUpdated.join(', ')}`);
            console.log(`[onOutflowUpdated] ✓ Periods queried: ${result.periodsQueried}`);
            console.log(`[onOutflowUpdated] ✓ Periods updated: ${result.periodsUpdated}`);
            console.log(`[onOutflowUpdated] ✓ Periods skipped (paid): ${result.periodsSkipped}`);
        }
        if (result.errors.length > 0) {
            console.log(`[onOutflowUpdated] ⚠️  Errors encountered: ${result.errors.length}`);
            result.errors.forEach((err, idx) => {
                console.log(`[onOutflowUpdated]    ${idx + 1}. ${err}`);
            });
        }
        console.log('[onOutflowUpdated] ════════════════════════════════════════════');
        console.log('');
    }
    catch (error) {
        console.error('');
        console.error('[onOutflowUpdated] ❌ CRITICAL ERROR:', error);
        console.error('');
        // Don't throw - we don't want to break outflow updates if period sync fails
    }
});
//# sourceMappingURL=onOutflowUpdated.js.map