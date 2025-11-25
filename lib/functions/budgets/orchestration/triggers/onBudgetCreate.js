"use strict";
/**
 * Budget Periods Auto-Generation
 *
 * This Cloud Function automatically creates budget_periods when a budget is created.
 * It queries the source_periods collection (single source of truth for all periods)
 * and creates budget_periods linked to existing source periods.
 *
 * Features:
 * - Uses source_periods as single source of truth (ensures consistency with outflow_periods)
 * - Multi-period type support (weekly, bi-monthly, monthly)
 * - Proportional amount calculation based on period type:
 *   • Monthly: Full budget amount
 *   • Bi-Monthly: Half budget amount (50%)
 *   • Weekly: Proportional amount (7/30.44 of monthly)
 * - Recurring budgets (budgetType: 'recurring'): 1 year of periods, extended by scheduled function
 * - Limited budgets (budgetType: 'limited'): Periods until specified end date
 * - Owner-based permissions with family role support
 * - Period ID format inherited from source periods for guaranteed consistency
 *
 * Architecture:
 * - Queries source_periods collection instead of generating periods independently
 * - Ensures budget_periods and outflow_periods use identical period definitions
 * - Single point of maintenance for period logic (source_periods generation)
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
exports.onBudgetCreate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const budgetSpending_1 = require("../../utils/budgetSpending");
const budgetPeriods_1 = require("../../utils/budgetPeriods");
/**
 * Triggered when a budget is created
 * Automatically generates budget_periods with intelligent time horizon:
 * - Recurring budgets: 1 year of periods (12 monthly, 24 bi-monthly, 52 weekly) + scheduled extension
 * - Limited budgets: Periods until specified end date
 * - Default: 1 year of periods (12 monthly, 24 bi-monthly, 52 weekly)
 */
exports.onBudgetCreate = (0, firestore_1.onDocumentCreated)({
    document: 'budgets/{budgetId}',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (event) => {
    var _a;
    try {
        const budgetId = event.params.budgetId;
        const budgetData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
        if (!budgetData) {
            console.error('No budget data found');
            return;
        }
        console.log(`Creating budget periods for budget: ${budgetId}`);
        console.log(`Budget data:`, {
            budgetType: budgetData.budgetType,
            budgetEndDate: budgetData.budgetEndDate ? budgetData.budgetEndDate.toDate().toISOString() : 'undefined',
            endDate: budgetData.endDate ? budgetData.endDate.toDate().toISOString() : 'undefined',
            startDate: budgetData.startDate ? budgetData.startDate.toDate().toISOString() : 'undefined'
        });
        const db = admin.firestore();
        // Generate budget periods using complete workflow
        const result = await (0, budgetPeriods_1.generateBudgetPeriodsForNewBudget)(db, budgetId, budgetData);
        console.log(`Successfully created ${result.count} budget periods for budget ${budgetId}`);
        // Recalculate spending from existing transactions that match budget categories
        try {
            console.log(`🔄 Starting spending recalculation for new budget ${budgetId}`);
            const recalcResult = await (0, budgetSpending_1.recalculateBudgetSpendingOnCreate)(budgetId, budgetData);
            console.log(`✅ Spending recalculation completed:`, {
                transactionsProcessed: recalcResult.transactionsProcessed,
                totalSpending: recalcResult.totalSpending,
                budgetPeriodsUpdated: recalcResult.budgetPeriodsUpdated,
                periodTypes: recalcResult.periodTypesUpdated
            });
        }
        catch (recalcError) {
            // Log error but don't fail budget creation
            console.error('❌ Error recalculating budget spending:', recalcError);
        }
    }
    catch (error) {
        console.error('Error in onBudgetCreate:', error);
        // Don't throw - we don't want to break budget creation if period generation fails
    }
});
//# sourceMappingURL=onBudgetCreate.js.map