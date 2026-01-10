"use strict";
/**
 * Create Transaction Cloud Function
 *
 * Creates a new transaction with automatic budget period assignment and splitting support.
 *
 * Memory: 256MiB, Timeout: 30s
 * CORS: Enabled
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
exports.createTransaction = void 0;
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const admin = __importStar(require("firebase-admin"));
const cors_1 = require("../../../../middleware/cors");
const budgetSpending_1 = require("../../../../utils/budgetSpending");
const matchTransactionSplitsToSourcePeriods_1 = require("../../utils/matchTransactionSplitsToSourcePeriods");
const validateBudgetIds_1 = require("../../utils/validateBudgetIds");
/**
 * Create a new transaction
 */
exports.createTransaction = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        if (request.method !== "POST") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests are allowed"));
        }
        try {
            // Authenticate user
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.VIEWER);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Validate request body
            const validation = (0, validation_1.validateRequest)(request.body, validation_1.createTransactionSchema);
            if (validation.error) {
                return response.status(400).json((0, auth_1.createErrorResponse)("validation-error", validation.error));
            }
            const transactionData = validation.value;
            // Check if user belongs to a family
            if (!user.familyId) {
                return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "User must belong to a family to create transactions"));
            }
            // Get family document to check settings
            const family = await (0, firestore_1.getDocument)("families", user.familyId);
            if (!family) {
                return response.status(404).json((0, auth_1.createErrorResponse)("family-not-found", "Family not found"));
            }
            // Check transaction permissions
            const permissionCheck = (0, validation_1.validateTransactionPermission)(user.role, transactionData.amount, family.settings);
            if (!permissionCheck.canCreate) {
                return response.status(403).json((0, auth_1.createErrorResponse)("permission-denied", permissionCheck.reason || "Cannot create transaction"));
            }
            // Determine group membership (convert legacy familyId to groupIds array)
            const groupIds = [];
            if (transactionData.groupId) {
                groupIds.push(transactionData.groupId);
            }
            else if (user.familyId) {
                groupIds.push(user.familyId);
            }
            // Transaction date for payment tracking and period matching
            const transactionDate = transactionData.date
                ? admin.firestore.Timestamp.fromDate(new Date(transactionData.date))
                : admin.firestore.Timestamp.now();
            // Create default split for the transaction (NEW FLAT STRUCTURE)
            const defaultSplit = {
                splitId: admin.firestore().collection('_dummy').doc().id,
                budgetId: transactionData.budgetId || 'unassigned',
                amount: transactionData.amount,
                description: null,
                isDefault: true,
                // Source period IDs (will be populated by matchTransactionSplitsToSourcePeriods)
                monthlyPeriodId: null,
                weeklyPeriodId: null,
                biWeeklyPeriodId: null,
                // Assignment references (populated when assigned)
                outflowId: null,
                // Category fields (NEW NAMING)
                plaidPrimaryCategory: transactionData.category,
                plaidDetailedCategory: transactionData.category,
                internalPrimaryCategory: null,
                internalDetailedCategory: null,
                // Enhanced status fields
                isIgnored: false,
                isRefund: false,
                isTaxDeductible: false,
                ignoredReason: null,
                refundReason: null,
                // Payment tracking
                paymentDate: transactionDate,
                // New array fields
                rules: [],
                tags: transactionData.tags || [],
                createdAt: admin.firestore.Timestamp.now(),
                updatedAt: admin.firestore.Timestamp.now(),
            };
            // Create transaction using NEW FLAT STRUCTURE
            const transaction = {
                // === ROOT-LEVEL QUERY FIELDS ===
                transactionId: admin.firestore().collection('_dummy').doc().id, // Generate ID for manual transactions
                ownerId: user.id,
                groupId: groupIds.length > 0 ? groupIds[0] : null,
                transactionDate,
                accountId: '', // Not available for manual transactions
                createdBy: user.id,
                updatedBy: user.id,
                currency: family.settings.currency,
                description: transactionData.description,
                // === CATEGORY FIELDS (flattened to root) ===
                internalDetailedCategory: null,
                internalPrimaryCategory: null,
                plaidDetailedCategory: transactionData.category,
                plaidPrimaryCategory: transactionData.category,
                // === PLAID METADATA (flattened to root) ===
                plaidItemId: '', // Not applicable for manual transactions
                source: 'manual',
                transactionStatus: permissionCheck.requiresApproval ? types_1.TransactionStatus.PENDING : types_1.TransactionStatus.APPROVED,
                // === TYPE AND IDENTIFIERS ===
                type: transactionData.type,
                name: transactionData.description,
                merchantName: null,
                // === SPLITS ARRAY ===
                splits: [defaultSplit],
                // === INITIAL PLAID DATA (not applicable for manual transactions) ===
                initialPlaidData: {
                    plaidAccountId: '',
                    plaidMerchantName: '',
                    plaidName: transactionData.description,
                    plaidTransactionId: '',
                    plaidPending: false,
                    source: 'plaid', // Keep as plaid type for consistency
                },
            };
            // Validate and auto-fix budgetIds before saving
            transaction.splits = await (0, validateBudgetIds_1.validateAndFixBudgetIds)(user.id, transaction.splits);
            // Match transaction splits to source periods (app-wide)
            const transactionsWithPeriods = await (0, matchTransactionSplitsToSourcePeriods_1.matchTransactionSplitsToSourcePeriods)([transaction]);
            const transactionWithPeriods = transactionsWithPeriods[0];
            const createdTransaction = await (0, firestore_1.createDocument)("transactions", transactionWithPeriods);
            // Update budget spending based on transaction splits
            try {
                await (0, budgetSpending_1.updateBudgetSpending)({
                    newTransaction: createdTransaction,
                    userId: user.id,
                    groupId: createdTransaction.groupId
                });
            }
            catch (budgetError) {
                // Log error but don't fail transaction creation
                console.error('Budget spending update failed after transaction creation:', budgetError);
            }
            return response.status(201).json((0, auth_1.createSuccessResponse)(createdTransaction));
        }
        catch (error) {
            console.error("Error creating transaction:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to create transaction"));
        }
    });
});
//# sourceMappingURL=createTransaction.js.map