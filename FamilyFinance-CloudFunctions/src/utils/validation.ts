import * as Joi from "joi";
import {
  CreateTransactionRequest,
  UpdateTransactionRequest,
  CreateBudgetRequest,
  CreateFamilyRequest,
  JoinFamilyRequest,
  TransactionCategory,
  TransactionType,
  BudgetPeriod,
  UserRole,
} from "../types";

// Common validation schemas (exported for reuse)
export const emailSchema = Joi.string().email().required();
export const idSchema = Joi.string().min(1).required();
const amountSchema = Joi.number().positive().required();
const currencySchema = Joi.string().length(3).uppercase();
const dateSchema = Joi.date().iso();

// Transaction validation schemas
export const createTransactionSchema = Joi.object<CreateTransactionRequest>({
  amount: amountSchema,
  description: Joi.string().min(1).max(500).required(),
  category: Joi.string().valid(...Object.values(TransactionCategory)).required(),
  type: Joi.string().valid(...Object.values(TransactionType)).required(),
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

export const updateTransactionSchema = Joi.object<UpdateTransactionRequest>({
  amount: Joi.number().positive().optional(),
  description: Joi.string().min(1).max(500).optional(),
  category: Joi.string().valid(...Object.values(TransactionCategory)).optional(),
  location: Joi.object({
    name: Joi.string().optional(),
    address: Joi.string().optional(),
    latitude: Joi.number().min(-90).max(90).optional(),
    longitude: Joi.number().min(-180).max(180).optional(),
  }).optional(),
  tags: Joi.array().items(Joi.string().min(1).max(50)).max(10).optional(),
});

// Budget validation schemas
export const createBudgetSchema = Joi.object<CreateBudgetRequest>({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).optional(),
  amount: amountSchema,
  category: Joi.string().valid(...Object.values(TransactionCategory)).required(),
  period: Joi.string().valid(...Object.values(BudgetPeriod)).required(),
  startDate: dateSchema.required(),
  endDate: dateSchema.optional(),
  alertThreshold: Joi.number().min(0).max(100).optional().default(80),
  memberIds: Joi.array().items(Joi.string()).optional(),
});

// Family validation schemas
export const createFamilySchema = Joi.object<CreateFamilyRequest>({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).optional(),
  settings: Joi.object({
    currency: currencySchema.optional().default("USD"),
    budgetPeriod: Joi.string().valid("weekly", "monthly", "yearly").optional().default("monthly"),
    requireApprovalForExpenses: Joi.boolean().optional().default(false),
    expenseApprovalLimit: Joi.number().min(0).optional().default(100),
    allowChildTransactions: Joi.boolean().optional().default(true),
  }).optional(),
});

export const joinFamilySchema = Joi.object<JoinFamilyRequest>({
  inviteCode: Joi.string().length(8).required(),
});

// User validation schemas
export const updateUserSchema = Joi.object({
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
export const queryOptionsSchema = Joi.object({
  limit: Joi.number().min(1).max(100).optional(),
  offset: Joi.number().min(0).optional(),
  orderBy: Joi.string().optional(),
  orderDirection: Joi.string().valid("asc", "desc").optional(),
  where: Joi.array().items(
    Joi.object({
      field: Joi.string().required(),
      operator: Joi.string().valid("==", "!=", "<", "<=", ">", ">=", "in", "not-in", "array-contains").required(),
      value: Joi.any().required(),
    })
  ).optional(),
});

// Date range validation
export const dateRangeSchema = Joi.object({
  startDate: dateSchema.required(),
  endDate: dateSchema.required(),
}).custom((value, helpers) => {
  if (new Date(value.startDate) >= new Date(value.endDate)) {
    return helpers.error("dateRange.invalid");
  }
  return value;
});

// Invite code validation
export const inviteCodeSchema = Joi.object({
  role: Joi.string().valid(...Object.values(UserRole)).required(),
  expiresInHours: Joi.number().min(1).max(168).optional().default(24), // 1 hour to 1 week
});

/**
 * Validates request data against a schema
 */
export function validateRequest<T>(
  data: unknown,
  schema: Joi.ObjectSchema<T>
): { value: T; error?: never } | { value?: never; error: string } {
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
export function validateUserPermission(
  userRole: UserRole,
  requiredRole: UserRole,
  targetUserId?: string,
  currentUserId?: string
): boolean {
  // Admin can do everything
  if (userRole === UserRole.ADMIN) {
    return true;
  }

  // Users can manage their own data
  if (targetUserId && currentUserId && targetUserId === currentUserId) {
    return true;
  }

  // Role hierarchy check
  const roleHierarchy = {
    [UserRole.ADMIN]: 4,
    [UserRole.PARENT]: 3,
    [UserRole.CHILD]: 2,
    [UserRole.VIEWER]: 1,
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * Validates if amount is within budget limits
 */
export function validateBudgetLimit(
  amount: number,
  budgetLimit: number,
  currentSpent: number
): { isValid: boolean; remainingAmount: number; exceededAmount: number } {
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
export function validateTransactionPermission(
  userRole: UserRole,
  transactionAmount: number,
  familySettings: {
    requireApprovalForExpenses: boolean;
    expenseApprovalLimit: number;
    allowChildTransactions: boolean;
  }
): { canCreate: boolean; requiresApproval: boolean; reason?: string } {
  // Check if children can make transactions
  if (userRole === UserRole.CHILD && !familySettings.allowChildTransactions) {
    return {
      canCreate: false,
      requiresApproval: false,
      reason: "Children are not allowed to create transactions",
    };
  }

  // Viewers cannot create transactions
  if (userRole === UserRole.VIEWER) {
    return {
      canCreate: false,
      requiresApproval: false,
      reason: "Viewers cannot create transactions",
    };
  }

  // Check if approval is required
  const requiresApproval = 
    familySettings.requireApprovalForExpenses && 
    transactionAmount > familySettings.expenseApprovalLimit &&
    userRole !== UserRole.ADMIN;

  return {
    canCreate: true,
    requiresApproval,
  };
}

/**
 * Custom Joi error messages
 */
export const customJoiMessages = {
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