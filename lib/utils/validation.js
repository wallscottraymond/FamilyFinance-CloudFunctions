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
exports.customJoiMessages = exports.inviteCodeSchema = exports.dateRangeSchema = exports.queryOptionsSchema = exports.updateUserSchema = exports.joinFamilySchema = exports.createFamilySchema = exports.createBudgetSchema = exports.updateTransactionSchema = exports.createTransactionSchema = exports.idSchema = exports.emailSchema = void 0;
exports.validateRequest = validateRequest;
exports.validateUserPermission = validateUserPermission;
exports.validateBudgetLimit = validateBudgetLimit;
exports.validateTransactionPermission = validateTransactionPermission;
exports.validateRequestBody = validateRequestBody;
exports.validateCategoryIds = validateCategoryIds;
const Joi = __importStar(require("joi"));
const admin = __importStar(require("firebase-admin"));
const types_1 = require("../types");
// Common validation schemas (exported for reuse)
exports.emailSchema = Joi.string().email().required();
exports.idSchema = Joi.string().min(1).required();
const amountSchema = Joi.number().positive().required();
const currencySchema = Joi.string().length(3).uppercase();
const dateSchema = Joi.date().iso();
// Transaction validation schemas
exports.createTransactionSchema = Joi.object({
    amount: amountSchema,
    description: Joi.string().min(1).max(500).required(),
    category: Joi.string().valid(...Object.values(types_1.TransactionCategory)).required(),
    type: Joi.string().valid(...Object.values(types_1.TransactionType)).required(),
    date: dateSchema.optional(),
    location: Joi.object({
        name: Joi.string().optional(),
        address: Joi.string().optional(),
        latitude: Joi.number().min(-90).max(90).optional(),
        longitude: Joi.number().min(-180).max(180).optional(),
    }).optional(),
    tags: Joi.array().items(Joi.string().min(1).max(50)).max(10).optional(),
    budgetId: Joi.string().optional(),
});
exports.updateTransactionSchema = Joi.object({
    amount: Joi.number().positive().optional(),
    description: Joi.string().min(1).max(500).optional(),
    category: Joi.string().valid(...Object.values(types_1.TransactionCategory)).optional(),
    location: Joi.object({
        name: Joi.string().optional(),
        address: Joi.string().optional(),
        latitude: Joi.number().min(-90).max(90).optional(),
        longitude: Joi.number().min(-180).max(180).optional(),
    }).optional(),
    tags: Joi.array().items(Joi.string().min(1).max(50)).max(10).optional(),
});
// Budget validation schemas
exports.createBudgetSchema = Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(500).optional(),
    amount: amountSchema,
    categoryIds: Joi.array().items(Joi.string().min(1)).min(1).required(), // Changed to categoryIds with dynamic validation
    period: Joi.string().valid(...Object.values(types_1.BudgetPeriod)).required(),
    budgetType: Joi.string().valid('recurring', 'limited').optional().default('recurring'),
    startDate: dateSchema.required(),
    endDate: dateSchema.optional(), // Legacy field for backward compatibility
    alertThreshold: Joi.number().min(0).max(100).optional().default(80),
    memberIds: Joi.array().items(Joi.string()).optional(),
    isShared: Joi.boolean().optional().default(false),
    selectedStartPeriod: Joi.string().optional(),
    // Budget end date functionality
    isOngoing: Joi.boolean().optional().default(true),
    budgetEndDate: Joi.when('isOngoing', {
        is: false,
        then: dateSchema.required().greater(Joi.ref('startDate')),
        otherwise: Joi.forbidden()
    }),
});
// Family validation schemas
exports.createFamilySchema = Joi.object({
    name: Joi.string().min(1).max(100).required(),
    description: Joi.string().max(500).optional(),
    settings: Joi.object({
        currency: currencySchema.optional().default("USD"),
        budgetPeriod: Joi.string().valid("weekly", "monthly", "yearly").optional().default("monthly"),
        requireApprovalForExpenses: Joi.boolean().optional().default(false),
        expenseApprovalLimit: Joi.number().min(0).optional().default(100),
        allowViewerTransactions: Joi.boolean().optional().default(true),
    }).optional(),
});
exports.joinFamilySchema = Joi.object({
    inviteCode: Joi.string().length(8).required(),
});
// User validation schemas
exports.updateUserSchema = Joi.object({
    displayName: Joi.string().min(1).max(100).optional(),
    photoURL: Joi.string().uri().optional(),
    preferences: Joi.object({
        currency: currencySchema.optional(),
        locale: Joi.string().min(2).max(10).optional(),
        theme: Joi.string().valid("light", "dark", "auto").optional(),
        notifications: Joi.object({
            email: Joi.boolean().optional(),
            push: Joi.boolean().optional(),
            transactionAlerts: Joi.boolean().optional(),
            budgetAlerts: Joi.boolean().optional(),
            weeklyReports: Joi.boolean().optional(),
        }).optional(),
    }).optional(),
});
// Query validation schemas
exports.queryOptionsSchema = Joi.object({
    limit: Joi.number().min(1).max(100).optional(),
    offset: Joi.number().min(0).optional(),
    orderBy: Joi.string().optional(),
    orderDirection: Joi.string().valid("asc", "desc").optional(),
    where: Joi.array().items(Joi.object({
        field: Joi.string().required(),
        operator: Joi.string().valid("==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains").required(),
        value: Joi.any().required(),
    })).optional(),
});
// Date range validation
exports.dateRangeSchema = Joi.object({
    startDate: dateSchema.required(),
    endDate: dateSchema.required(),
}).custom((value, helpers) => {
    if (new Date(value.startDate) >= new Date(value.endDate)) {
        return helpers.error("dateRange.invalid");
    }
    return value;
});
// Invite code validation
exports.inviteCodeSchema = Joi.object({
    role: Joi.string().valid(...Object.values(types_1.UserRole)).required(),
    expiresInHours: Joi.number().min(1).max(168).optional().default(24), // 1 hour to 1 week
});
/**
 * Validates request data against a schema
 */
function validateRequest(data, schema) {
    const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
    });
    if (error) {
        const errorMessage = error.details.map(detail => detail.message).join(", ");
        return { error: errorMessage };
    }
    return { value };
}
/**
 * Validates if user has permission for a specific action
 */
function validateUserPermission(userRole, requiredRole, targetUserId, currentUserId) {
    // Admin can do everything
    if (userRole === types_1.UserRole.ADMIN) {
        return true;
    }
    // Users can manage their own data
    if (targetUserId && currentUserId && targetUserId === currentUserId) {
        return true;
    }
    // Role hierarchy check
    const roleHierarchy = {
        [types_1.UserRole.ADMIN]: 3,
        [types_1.UserRole.EDITOR]: 2,
        [types_1.UserRole.VIEWER]: 1,
    };
    return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}
/**
 * Validates if amount is within budget limits
 */
function validateBudgetLimit(amount, budgetLimit, currentSpent) {
    const remainingAmount = budgetLimit - currentSpent;
    const exceededAmount = Math.max(0, amount - remainingAmount);
    const isValid = amount <= remainingAmount;
    return {
        isValid,
        remainingAmount: Math.max(0, remainingAmount),
        exceededAmount,
    };
}
/**
 * Validates if user can perform transaction
 */
function validateTransactionPermission(userRole, transactionAmount, familySettings) {
    // Check if viewers can make transactions
    if (userRole === types_1.UserRole.VIEWER && !familySettings.allowViewerTransactions) {
        return {
            canCreate: false,
            requiresApproval: false,
            reason: "Viewers are not allowed to create transactions",
        };
    }
    // Check if approval is required
    const requiresApproval = familySettings.requireApprovalForExpenses &&
        transactionAmount > familySettings.expenseApprovalLimit &&
        userRole !== types_1.UserRole.ADMIN;
    return {
        canCreate: true,
        requiresApproval,
    };
}
/**
 * Custom Joi error messages
 */
exports.customJoiMessages = {
    "string.empty": "Field cannot be empty",
    "string.min": "Field must be at least {#limit} characters long",
    "string.max": "Field cannot exceed {#limit} characters",
    "number.positive": "Amount must be a positive number",
    "number.min": "Value must be at least {#limit}",
    "number.max": "Value cannot exceed {#limit}",
    "date.base": "Invalid date format",
    "any.required": "Field is required",
    "array.max": "Too many items in array",
    "dateRange.invalid": "End date must be after start date",
};
/**
 * Validates request body against Zod schema (used in Plaid functions)
 */
function validateRequestBody(data, schema) {
    try {
        const validatedData = schema.parse(data);
        return { success: true, data: validatedData };
    }
    catch (error) {
        return {
            success: false,
            error: {
                errors: error.errors || [{ message: error.message }],
            },
        };
    }
}
/**
 * Validates category IDs against the categories collection
 */
async function validateCategoryIds(categoryIds) {
    try {
        const db = admin.firestore();
        // Get all provided category IDs from the database
        const categoryPromises = categoryIds.map(id => db.collection('categories').doc(id).get());
        const categoryDocs = await Promise.all(categoryPromises);
        const invalidIds = [];
        const validCategories = [];
        categoryDocs.forEach((doc, index) => {
            const categoryId = categoryIds[index];
            if (!doc.exists) {
                invalidIds.push(categoryId);
            }
            else {
                const data = doc.data();
                // Check if category is active
                if ((data === null || data === void 0 ? void 0 : data.isActive) === false) {
                    invalidIds.push(categoryId);
                }
                else {
                    validCategories.push({
                        id: categoryId,
                        name: (data === null || data === void 0 ? void 0 : data.name) || 'Unknown',
                        type: (data === null || data === void 0 ? void 0 : data.type) || 'Unknown'
                    });
                }
            }
        });
        return {
            isValid: invalidIds.length === 0,
            invalidIds,
            validCategories
        };
    }
    catch (error) {
        console.error('Error validating category IDs:', error);
        return {
            isValid: false,
            invalidIds: categoryIds, // Mark all as invalid if we can't validate
            validCategories: []
        };
    }
}
//# sourceMappingURL=validation.js.map