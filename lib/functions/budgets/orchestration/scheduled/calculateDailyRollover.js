"use strict";
/**
 * Scheduled Daily Rollover Calculation
 *
 * This Cloud Function runs daily to ensure rollover amounts are calculated
 * for budget periods that just became current. This catches periods that
 * became active without any spending activity triggering the recalculation.
 *
 * Runs daily at 3:00 AM UTC (after period extension at 2:00 AM)
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
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
exports.calculateDailyRollover = void 0;
const scheduler_1 = require("firebase-functions/v2/scheduler");
const admin = __importStar(require("firebase-admin"));
const rolloverChainCalculation_1 = require("../../utils/rolloverChainCalculation");
/**
 * Scheduled function to calculate rollover for current periods
 * Runs daily at 3:00 AM UTC
 */
exports.calculateDailyRollover = (0, scheduler_1.onSchedule)({
    schedule: '0 3 * * *', // Cron: 3:00 AM UTC every day
    timeZone: 'UTC',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
}, async (event) => {
    console.log('');
    console.log('🔄 ════════════════════════════════════════════════════════════');
    console.log('🔄 STARTING DAILY ROLLOVER CALCULATION');
    console.log('🔄 ════════════════════════════════════════════════════════════');
    console.log(`🔄 Execution time: ${new Date().toISOString()}`);
    console.log('');
    const db = admin.firestore();
    try {
        const result = await (0, rolloverChainCalculation_1.recalculateRolloverForCurrentPeriods)(db);
        console.log('');
        console.log('🔄 ════════════════════════════════════════════════════════════');
        console.log('🔄 DAILY ROLLOVER CALCULATION COMPLETE');
        console.log('🔄 ════════════════════════════════════════════════════════════');
        console.log(`🔄 Budgets processed: ${result.budgetsProcessed}`);
        console.log(`🔄 Periods updated: ${result.periodsUpdated}`);
        if (result.errors.length > 0) {
            console.warn(`🔄 Errors encountered: ${result.errors.length}`);
            result.errors.forEach((error, index) => {
                console.warn(`   ${index + 1}. ${error}`);
            });
        }
        console.log('');
    }
    catch (error) {
        console.error('');
        console.error('🔄 ❌ FATAL ERROR in daily rollover calculation:', error);
        console.error('');
        throw error; // Re-throw to mark the function execution as failed
    }
});
//# sourceMappingURL=calculateDailyRollover.js.map