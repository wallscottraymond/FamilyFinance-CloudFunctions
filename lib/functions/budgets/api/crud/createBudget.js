"use strict";
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
exports.createBudget = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../../../../types");
const firestore_1 = require("../../../../utils/firestore");
const auth_1 = require("../../../../utils/auth");
const validation_1 = require("../../../../utils/validation");
const cors_1 = require("../../../../middleware/cors");
const documentStructure_1 = require("../../../../utils/documentStructure");
/**
 * Create a new budget
 */
exports.createBudget = (0, https_1.onRequest)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    cors: true
}, async (request, response) => {
    return (0, cors_1.firebaseCors)(request, response, async () => {
        var _a, _b;
        if (request.method !== "POST") {
            return response.status(405).json((0, auth_1.createErrorResponse)("method-not-allowed", "Only POST requests are allowed"));
        }
        try {
            // Authenticate user (editor or admin can create budgets)
            const authResult = await (0, auth_1.authMiddleware)(request, types_1.UserRole.EDITOR);
            if (!authResult.success || !authResult.user) {
                return response.status(401).json(authResult.error);
            }
            const { user } = authResult;
            // Validate request body
            const validation = (0, validation_1.validateRequest)(request.body, validation_1.createBudgetSchema);
            if (validation.error) {
                return response.status(400).json((0, auth_1.createErrorResponse)("validation-error", validation.error));
            }
            const budgetData = validation.value;
            // Validate category IDs against categories collection
            const categoryValidation = await (0, validation_1.validateCategoryIds)(budgetData.categoryIds);
            if (!categoryValidation.isValid) {
                return response.status(400).json((0, auth_1.createErrorResponse)("invalid-categories", `Invalid category IDs: ${categoryValidation.invalidIds.join(', ')}`));
            }
            console.log(`Valid categories for budget:`, categoryValidation.validCategories);
            // Determine if this is a shared budget and validate accordingly
            const isSharedBudget = budgetData.isShared || false;
            let currency = "USD"; // Default currency
            if (isSharedBudget) {
                // For shared budgets, user must belong to a family
                if (!user.familyId) {
                    return response.status(400).json((0, auth_1.createErrorResponse)("no-family", "User must belong to a family to create shared budgets"));
                }
                // Get family for currency and settings
                const family = await (0, firestore_1.getDocument)("families", user.familyId);
                if (!family) {
                    return response.status(404).json((0, auth_1.createErrorResponse)("family-not-found", "Family not found"));
                }
                currency = ((_a = family.settings) === null || _a === void 0 ? void 0 : _a.currency) || "USD";
            }
            else {
                // For individual budgets, use user's preferred currency
                currency = ((_b = user.preferences) === null || _b === void 0 ? void 0 : _b.currency) || "USD";
            }
            // Calculate dates based on period
            const startDate = new Date(budgetData.startDate);
            let endDate;
            if (budgetData.endDate) {
                // Legacy support for endDate field
                endDate = new Date(budgetData.endDate);
            }
            else {
                // Auto-calculate end date based on period
                endDate = new Date(startDate);
                switch (budgetData.period) {
                    case types_1.BudgetPeriod.WEEKLY:
                        endDate.setDate(endDate.getDate() + 7);
                        break;
                    case types_1.BudgetPeriod.MONTHLY:
                        endDate.setMonth(endDate.getMonth() + 1);
                        break;
                    case types_1.BudgetPeriod.QUARTERLY:
                        endDate.setMonth(endDate.getMonth() + 3);
                        break;
                    case types_1.BudgetPeriod.YEARLY:
                        endDate.setFullYear(endDate.getFullYear() + 1);
                        break;
                    default:
                        endDate.setMonth(endDate.getMonth() + 1); // Default to monthly
                }
            }
            // Handle budget end date functionality
            const isOngoing = budgetData.isOngoing !== undefined ? budgetData.isOngoing : true;
            let budgetEndDate;
            if (!isOngoing && budgetData.budgetEndDate) {
                budgetEndDate = new Date(budgetData.budgetEndDate);
                // Validate that budget end date is after start date
                if (budgetEndDate <= startDate) {
                    return response.status(400).json((0, auth_1.createErrorResponse)("invalid-end-date", "Budget end date must be after start date"));
                }
            }
            // Determine groupIds for access control (convert single groupId to array)
            const groupIds = [];
            const singleGroupId = budgetData.groupId || (isSharedBudget ? user.familyId : null);
            if (singleGroupId) {
                groupIds.push(singleGroupId);
            }
            // Step 1: Build complete budget structure with defaults
            const budgetDoc = {
                // === QUERY-CRITICAL FIELDS AT ROOT (defaults) ===
                userId: user.id,
                groupIds,
                isActive: true,
                // === NESTED ACCESS CONTROL OBJECT (defaults) ===
                access: (0, documentStructure_1.buildAccessControl)(user.id, user.id, groupIds),
                // === NEW RBAC FIELDS ===
                createdBy: user.id,
                ownerId: user.id,
                isPrivate: groupIds.length === 0,
                // === LEGACY FIELDS (Backward compatibility) ===
                familyId: isSharedBudget ? user.familyId : undefined,
                groupId: singleGroupId, // Keep for backward compatibility
                accessibleBy: [user.id], // Deprecated - kept for compatibility
                memberIds: [user.id], // Deprecated - kept for compatibility
                isShared: isSharedBudget,
                // === BUDGET DATA ===
                name: budgetData.name,
                description: budgetData.description,
                amount: budgetData.amount,
                currency: currency,
                categoryIds: budgetData.categoryIds, // Use validated category IDs
                period: budgetData.period,
                budgetType: (budgetData.budgetType || 'recurring'),
                startDate: admin.firestore.Timestamp.fromDate(startDate),
                endDate: admin.firestore.Timestamp.fromDate(endDate), // Legacy field
                spent: 0,
                remaining: budgetData.amount,
                alertThreshold: budgetData.alertThreshold || 80,
                selectedStartPeriod: budgetData.selectedStartPeriod, // Pass through for onBudgetCreate trigger
                // Budget end date functionality
                isOngoing: isOngoing,
                budgetEndDate: budgetEndDate ? admin.firestore.Timestamp.fromDate(budgetEndDate) : undefined,
            };
            // Step 2: Budget is ready (no more enhanceWithGroupSharing needed)
            // Access control is now handled by Firestore security rules checking groupIds
            console.log(`✅ [createBudget] Budget created:`, {
                userId: user.id,
                groupIds,
                groupCount: groupIds.length,
                isPrivate: groupIds.length === 0
            });
            const finalBudget = budgetDoc;
            // Step 4: Save to Firestore (single write)
            const createdBudget = await (0, firestore_1.createDocument)("budgets", finalBudget);
            return response.status(201).json((0, auth_1.createSuccessResponse)(createdBudget));
        }
        catch (error) {
            console.error("Error creating budget:", error);
            return response.status(500).json((0, auth_1.createErrorResponse)("internal-error", "Failed to create budget"));
        }
    });
});
//# sourceMappingURL=createBudget.js.map