"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBudget = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const firestore_2 = require("../../../../utils/firestore");
const validation_1 = require("../../../../utils/validation");
const documentStructure_1 = require("../../../../utils/documentStructure");
const categoryTransfer_1 = require("../../utils/categoryTransfer");
/**
 * Create a new budget
 *
 * Callable function (use with Firebase Functions SDK httpsCallable)
 */
exports.createBudget = (0, https_1.onCall)({
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30
}, async (request) => {
    var _a, _b;
    console.log('🚀 [createBudget] Function called with data:', JSON.stringify(request.data, null, 2));
    console.log('🔐 [createBudget] Auth:', request.auth ? `userId: ${request.auth.uid}` : 'NO AUTH');
    try {
        // Check authentication
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'User must be authenticated');
        }
        // Get user document to check role
        console.log('👤 [createBudget] Fetching user document for:', request.auth.uid);
        const userDoc = await (0, firestore_2.getDocument)('users', request.auth.uid);
        if (!userDoc) {
            throw new https_1.HttpsError('not-found', 'User profile not found');
        }
        const user = Object.assign(Object.assign({}, userDoc), { id: request.auth.uid });
        console.log('✅ [createBudget] User found:', user.id, 'role:', user.role);
        // Check user role
        if (user.role !== types_1.UserRole.EDITOR && user.role !== types_1.UserRole.ADMIN) {
            console.error('❌ [createBudget] Permission denied - user role:', user.role);
            throw new https_1.HttpsError('permission-denied', `Required role: editor, user role: ${user.role}`);
        }
        console.log('✅ [createBudget] Role check passed');
        // Validate request data
        console.log('🔍 [createBudget] Validating request data...');
        const validation = (0, validation_1.validateRequest)(request.data, validation_1.createBudgetSchema);
        if (validation.error) {
            throw new https_1.HttpsError('invalid-argument', validation.error);
        }
        const budgetData = validation.value;
        // Validate category IDs against categories collection
        const categoryValidation = await (0, validation_1.validateCategoryIds)(budgetData.categoryIds);
        if (!categoryValidation.isValid) {
            throw new https_1.HttpsError('invalid-argument', `Invalid category IDs: ${categoryValidation.invalidIds.join(', ')}`);
        }
        console.log(`Valid categories for budget:`, categoryValidation.validCategories);
        // Determine if this is a shared budget and validate accordingly
        const isSharedBudget = budgetData.isShared || false;
        let currency = "USD"; // Default currency
        if (isSharedBudget) {
            // For shared budgets, user must belong to a family
            if (!user.familyId) {
                throw new https_1.HttpsError('failed-precondition', 'User must belong to a family to create shared budgets');
            }
            // Get family for currency and settings
            const family = await (0, firestore_2.getDocument)("families", user.familyId);
            if (!family) {
                throw new https_1.HttpsError('not-found', 'Family not found');
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
                throw new https_1.HttpsError('invalid-argument', 'Budget end date must be after start date');
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
            startDate: firestore_1.Timestamp.fromDate(startDate),
            endDate: firestore_1.Timestamp.fromDate(endDate), // Legacy field
            spent: 0,
            remaining: budgetData.amount,
            alertThreshold: budgetData.alertThreshold || 80,
            selectedStartPeriod: budgetData.selectedStartPeriod, // Pass through for onBudgetCreate trigger
            // Budget end date functionality
            isOngoing: isOngoing,
            budgetEndDate: budgetEndDate ? firestore_1.Timestamp.fromDate(budgetEndDate) : undefined,
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
        const createdBudget = await (0, firestore_2.createDocument)("budgets", finalBudget);
        console.log('✅ Budget created successfully:', createdBudget.id);
        // Step 5: Transfer categories from their current owners (e.g., "Everything Else")
        // This removes the categories from other budgets that currently own them
        if (budgetData.categoryIds && budgetData.categoryIds.length > 0) {
            console.log(`🔄 [createBudget] Transferring ${budgetData.categoryIds.length} categories to new budget`);
            const transferResult = await (0, categoryTransfer_1.claimCategories)(user.id, budgetData.categoryIds, createdBudget.id);
            if (transferResult.success) {
                console.log(`✅ [createBudget] Category transfer complete:`, {
                    transferred: transferResult.transferred.length,
                    alreadyOwned: transferResult.alreadyOwned.length,
                });
            }
            else {
                // Log but don't fail - the budget was created successfully
                console.warn(`⚠️ [createBudget] Category transfer had issues:`, transferResult.errors);
            }
        }
        return createdBudget;
    }
    catch (error) {
        console.error("Error creating budget:", error);
        // Re-throw HttpsErrors as-is
        if (error.code && error.message) {
            throw error;
        }
        // Wrap unknown errors
        throw new https_1.HttpsError('internal', 'Failed to create budget');
    }
});
//# sourceMappingURL=createBudget.js.map