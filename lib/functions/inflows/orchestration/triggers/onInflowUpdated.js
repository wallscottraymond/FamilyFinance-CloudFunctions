"use strict";
/**
 * Inflow Updated Trigger
 *
 * This Cloud Function automatically updates inflow_periods when an inflow is modified.
 * It handles changes to amount, custom name, and transaction IDs.
 *
 * Key Features:
 * - Detects changes to averageAmount, userCustomName, transactionIds
 * - Cascades updates to all related inflow_periods
 * - Re-runs transaction alignment when new transactions are added
 * - Preserves received income data (only updates unreceived periods for amounts)
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
exports.onInflowUpdated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const runUpdateInflowPeriods_1 = require("../../inflow_periods/utils/runUpdateInflowPeriods");
/**
 * Triggered when an inflow is updated
 * Automatically cascades changes to inflow_periods
 */
exports.onInflowUpdated = (0, firestore_1.onDocumentUpdated)({
    document: 'inflows/{inflowId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b;
    try {
        const inflowId = event.params.inflowId;
        const beforeData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
        const afterData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
        if (!beforeData || !afterData) {
            console.error('[onInflowUpdated] Missing before or after data');
            return;
        }
        // Skip if inflow is inactive
        if (!afterData.isActive) {
            console.log(`[onInflowUpdated] Skipping inactive inflow: ${inflowId}`);
            return;
        }
        console.log(`[onInflowUpdated] Processing update for inflow: ${inflowId}`);
        console.log(`[onInflowUpdated] Description: ${afterData.description || afterData.userCustomName || 'unnamed'}`);
        // Initialize Firestore
        const db = admin.firestore();
        // Run the update logic
        const result = await (0, runUpdateInflowPeriods_1.runUpdateInflowPeriods)(db, inflowId, beforeData, afterData);
        if (result.success) {
            console.log(`[onInflowUpdated] ✓ Successfully processed inflow ${inflowId}`);
            console.log(`[onInflowUpdated]   - Periods queried: ${result.periodsQueried}`);
            console.log(`[onInflowUpdated]   - Periods updated: ${result.periodsUpdated}`);
            console.log(`[onInflowUpdated]   - Periods skipped: ${result.periodsSkipped}`);
            console.log(`[onInflowUpdated]   - Fields updated: ${result.fieldsUpdated.join(', ') || 'none'}`);
        }
        else {
            console.error(`[onInflowUpdated] ✗ Failed to process inflow ${inflowId}`);
            console.error(`[onInflowUpdated]   - Errors: ${result.errors.join(', ')}`);
        }
    }
    catch (error) {
        console.error('[onInflowUpdated] Error:', error);
        // Don't throw - we don't want to break other operations
    }
});
//# sourceMappingURL=onInflowUpdated.js.map