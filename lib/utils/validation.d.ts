import * as Joi from "joi";
import { CreateTransactionRequest, UpdateTransactionRequest, CreateBudgetRequest, CreateFamilyRequest, JoinFamilyRequest, UserRole } from "../types";
export declare const emailSchema: Joi.StringSchema<string>;
export declare const idSchema: Joi.StringSchema<string>;
export declare const createTransactionSchema: Joi.ObjectSchema<CreateTransactionRequest>;
export declare const updateTransactionSchema: Joi.ObjectSchema<UpdateTransactionRequest>;
export declare const createBudgetSchema: Joi.ObjectSchema<CreateBudgetRequest>;
export declare const createFamilySchema: Joi.ObjectSchema<CreateFamilyRequest>;
export declare const joinFamilySchema: Joi.ObjectSchema<JoinFamilyRequest>;
export declare const updateUserSchema: Joi.ObjectSchema<any>;
export declare const queryOptionsSchema: Joi.ObjectSchema<any>;
export declare const dateRangeSchema: Joi.ObjectSchema<any>;
export declare const inviteCodeSchema: Joi.ObjectSchema<any>;
/**
 * Validates request data against a schema
 */
export declare function validateRequest<T>(data: unknown, schema: Joi.ObjectSchema<T>): {
    value: T;
    error?: never;
} | {
    value?: never;
    error: string;
};
/**
 * Validates if user has permission for a specific action
 */
export declare function validateUserPermission(userRole: UserRole, requiredRole: UserRole, targetUserId?: string, currentUserId?: string): boolean;
/**
 * Validates if amount is within budget limits
 */
export declare function validateBudgetLimit(amount: number, budgetLimit: number, currentSpent: number): {
    isValid: boolean;
    remainingAmount: number;
    exceededAmount: number;
};
/**
 * Validates if user can perform transaction
 */
export declare function validateTransactionPermission(userRole: UserRole, transactionAmount: number, familySettings: {
    requireApprovalForExpenses: boolean;
    expenseApprovalLimit: number;
    allowViewerTransactions: boolean;
}): {
    canCreate: boolean;
    requiresApproval: boolean;
    reason?: string;
};
/**
 * Custom Joi error messages
 */
export declare const customJoiMessages: {
    "string.empty": string;
    "string.min": string;
    "string.max": string;
    "number.positive": string;
    "number.min": string;
    "number.max": string;
    "date.base": string;
    "any.required": string;
    "array.max": string;
    "dateRange.invalid": string;
};
/**
 * Validates request body against Zod schema (used in Plaid functions)
 */
export declare function validateRequestBody<T>(data: unknown, schema: {
    parse: (data: unknown) => T;
}): {
    success: true;
    data: T;
} | {
    success: false;
    error: {
        errors: any[];
    };
};
/**
 * Validates category IDs against the categories collection
 */
export declare function validateCategoryIds(categoryIds: string[]): Promise<{
    isValid: boolean;
    invalidIds: string[];
    validCategories: {
        id: string;
        name: string;
        type: string;
    }[];
}>;
//# sourceMappingURL=validation.d.ts.map