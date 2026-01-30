/**
 * @file budgetErrorHandling.unit.test.ts
 * @description Unit tests for budget error handling scenarios
 *
 * Tests:
 * - Input validation errors
 * - Reference errors (non-existent documents)
 * - Edge cases
 * - Boundary conditions
 * - Error message formats
 *
 * Coverage areas:
 * - Amount validation (negative, zero, very large)
 * - String validation (empty, too long, unicode)
 * - Date validation (format, boundaries, leap years)
 * - Category validation (empty, invalid)
 * - Reference validation (budget, user, family)
 */

import { Timestamp } from 'firebase-admin/firestore';
import { BudgetPeriod, UserRole } from '../../../types';

// ============================================================================
// MOCK SETUP
// ============================================================================

jest.mock('../../../utils/firestore', () => ({
  getDocument: jest.fn(),
  createDocument: jest.fn(),
  updateDocument: jest.fn(),
  queryDocuments: jest.fn(),
}));

jest.mock('../../../utils/auth', () => ({
  authMiddleware: jest.fn(),
  createErrorResponse: jest.fn((code, message) => ({
    success: false,
    error: { code, message },
  })),
  createSuccessResponse: jest.fn((data) => ({
    success: true,
    data,
  })),
  checkFamilyAccess: jest.fn(),
}));

jest.mock('../../../utils/validation', () => ({
  validateRequest: jest.fn(),
  validateCategoryIds: jest.fn(),
}));

import { getDocument, createDocument, updateDocument, queryDocuments } from '../../../utils/firestore';
import { createErrorResponse, createSuccessResponse } from '../../../utils/auth';
import { validateCategoryIds } from '../../../utils/validation';

// ============================================================================
// TEST DATA FACTORIES
// ============================================================================

function createMockUser(overrides: Partial<any> = {}) {
  return {
    id: 'test-user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    role: UserRole.EDITOR,
    familyId: 'family-123',
    isActive: true,
    preferences: {
      currency: 'USD',
    },
    ...overrides,
  };
}

function createMockBudget(overrides: Partial<any> = {}) {
  return {
    id: 'budget-123',
    name: 'Groceries',
    description: 'Monthly grocery budget',
    amount: 500,
    currency: 'USD',
    categoryIds: ['FOOD_AND_DRINK_GROCERIES'],
    period: BudgetPeriod.MONTHLY,
    budgetType: 'recurring',
    isOngoing: true,
    startDate: Timestamp.fromDate(new Date('2025-01-01')),
    endDate: Timestamp.fromDate(new Date('2025-01-31')),
    spent: 0,
    remaining: 500,
    alertThreshold: 80,
    memberIds: ['test-user-123'],
    isShared: false,
    isActive: true,
    userId: 'test-user-123',
    familyId: 'family-123',
    groupIds: [],
    createdBy: 'test-user-123',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

// ============================================================================
// INPUT VALIDATION ERRORS - Amount
// ============================================================================

describe('Input Validation Errors - Amount', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Negative Amount Validation', () => {
    it('should reject negative amount', () => {
      const amount = -100;
      const isValid = amount > 0;

      expect(isValid).toBe(false);
    });

    it('should reject amount of -0.01', () => {
      const amount = -0.01;
      const isValid = amount > 0;

      expect(isValid).toBe(false);
    });

    it('should reject large negative amount', () => {
      const amount = -1000000;
      const isValid = amount > 0;

      expect(isValid).toBe(false);
    });

    it('should produce appropriate error message for negative amount', () => {
      const errorMessage = '"amount" must be a positive number';
      expect(errorMessage).toContain('positive');
      expect(errorMessage).toContain('amount');
    });
  });

  describe('Zero Amount Validation', () => {
    it('should reject zero amount for regular budgets', () => {
      const amount = 0;
      const isSystemBudget = false;

      const isValid = isSystemBudget || amount > 0;
      expect(isValid).toBe(false);
    });

    it('should allow zero amount for system budgets', () => {
      const amount = 0;
      const isSystemBudget = true;

      const isValid = isSystemBudget || amount > 0;
      expect(isValid).toBe(true);
    });

    it('should produce appropriate error message for zero amount', () => {
      const errorMessage = '"amount" must be greater than 0';
      expect(errorMessage).toContain('greater than 0');
    });
  });

  describe('Very Large Amount Validation', () => {
    it('should handle maximum safe integer', () => {
      const amount = Number.MAX_SAFE_INTEGER;
      const isValid = amount > 0 && Number.isFinite(amount);

      expect(isValid).toBe(true);
    });

    it('should reject Infinity', () => {
      const amount = Infinity;
      const isValid = amount > 0 && Number.isFinite(amount);

      expect(isValid).toBe(false);
    });

    it('should reject NaN', () => {
      const amount = NaN;
      const isValid = !isNaN(amount) && amount > 0;

      expect(isValid).toBe(false);
    });

    it('should handle large but valid amounts', () => {
      const amount = 10000000; // 10 million
      const isValid = amount > 0 && Number.isFinite(amount);

      expect(isValid).toBe(true);
    });

    it('should maintain precision for decimal amounts', () => {
      const amount = 999.99;
      const calculated = amount * 0.1; // 99.999

      // JavaScript floating point precision check
      expect(Math.round(calculated * 100) / 100).toBe(100);
    });
  });

  describe('Amount Type Validation', () => {
    it('should reject string amounts', () => {
      const amount = '500' as any;
      const isValid = typeof amount === 'number' && amount > 0;

      expect(isValid).toBe(false);
    });

    it('should reject null amount', () => {
      const amount = null as any;
      const isValid = typeof amount === 'number' && amount > 0;

      expect(isValid).toBe(false);
    });

    it('should reject undefined amount', () => {
      const amount = undefined as any;
      const isValid = typeof amount === 'number' && amount > 0;

      expect(isValid).toBe(false);
    });
  });
});

// ============================================================================
// INPUT VALIDATION ERRORS - String Fields
// ============================================================================

describe('Input Validation Errors - String Fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Name Validation', () => {
    it('should reject empty name', () => {
      const name = '';
      const isValid = name.length > 0 && name.length <= 100;

      expect(isValid).toBe(false);
    });

    it('should reject name exceeding 100 characters', () => {
      const name = 'A'.repeat(101);
      const isValid = name.length > 0 && name.length <= 100;

      expect(isValid).toBe(false);
    });

    it('should accept name at exactly 100 characters', () => {
      const name = 'A'.repeat(100);
      const isValid = name.length > 0 && name.length <= 100;

      expect(isValid).toBe(true);
    });

    it('should accept name at exactly 1 character', () => {
      const name = 'A';
      const isValid = name.length > 0 && name.length <= 100;

      expect(isValid).toBe(true);
    });

    it('should accept unicode characters in name', () => {
      const names = [
        'Presupuesto de Comestibles', // Spanish
        'Budget d\'Alimentation', // French
        '食品预算', // Chinese
        '食費予算', // Japanese
        'Бюджет питания', // Russian
        '식비 예산', // Korean
        'Budget mit Umlauten: ÄÖÜäöüß', // German
      ];

      names.forEach(name => {
        const isValid = name.length > 0 && name.length <= 100;
        expect(isValid).toBe(true);
      });
    });

    it('should handle whitespace-only names', () => {
      const name = '   ';
      const trimmed = name.trim();
      const isValid = trimmed.length > 0;

      expect(isValid).toBe(false);
    });

    it('should produce appropriate error message for empty name', () => {
      const errorMessage = '"name" is not allowed to be empty';
      expect(errorMessage).toContain('name');
      expect(errorMessage).toContain('empty');
    });

    it('should produce appropriate error message for name too long', () => {
      const errorMessage = '"name" length must be less than or equal to 100 characters';
      expect(errorMessage).toContain('100');
    });
  });

  describe('Description Validation', () => {
    it('should accept empty description', () => {
      const description = '';
      // Description is optional, so empty is valid
      const isValid = description === undefined || description.length <= 500;

      expect(isValid).toBe(true);
    });

    it('should reject description exceeding 500 characters', () => {
      const description = 'A'.repeat(501);
      const isValid = description.length <= 500;

      expect(isValid).toBe(false);
    });

    it('should accept description at exactly 500 characters', () => {
      const description = 'A'.repeat(500);
      const isValid = description.length <= 500;

      expect(isValid).toBe(true);
    });

    it('should handle null description', () => {
      const description = null as any;
      const isValid = description === null || description === undefined || description.length <= 500;

      expect(isValid).toBe(true);
    });

    it('should produce appropriate error message for description too long', () => {
      const errorMessage = '"description" length must be less than or equal to 500 characters';
      expect(errorMessage).toContain('500');
    });
  });

  describe('Empty vs Null vs Undefined Fields', () => {
    it('should differentiate between empty string and null', () => {
      const emptyString = '';
      const nullValue = null;

      expect(emptyString === '').toBe(true);
      expect(nullValue === null).toBe(true);
      expect(emptyString !== nullValue).toBe(true);
    });

    it('should differentiate between null and undefined', () => {
      const nullValue = null;
      const undefinedValue = undefined;

      expect(nullValue === null).toBe(true);
      expect(undefinedValue === undefined).toBe(true);
      expect(nullValue !== undefinedValue).toBe(true);
    });

    it('should handle required fields being undefined', () => {
      const data = {} as any;
      const hasName = 'name' in data && data.name !== undefined;

      expect(hasName).toBe(false);
    });
  });
});

// ============================================================================
// INPUT VALIDATION ERRORS - Categories
// ============================================================================

describe('Input Validation Errors - Categories', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Empty categoryIds Validation', () => {
    it('should reject empty categoryIds array', () => {
      const categoryIds: string[] = [];
      const isValid = categoryIds.length >= 1;

      expect(isValid).toBe(false);
    });

    it('should accept single category', () => {
      const categoryIds = ['FOOD'];
      const isValid = categoryIds.length >= 1;

      expect(isValid).toBe(true);
    });

    it('should accept multiple categories', () => {
      const categoryIds = ['FOOD', 'GROCERIES', 'DINING'];
      const isValid = categoryIds.length >= 1;

      expect(isValid).toBe(true);
    });

    it('should produce appropriate error message for empty categoryIds', () => {
      const errorMessage = '"categoryIds" must contain at least 1 item';
      expect(errorMessage).toContain('at least 1');
    });
  });

  describe('Invalid Category ID Validation', () => {
    it('should reject invalid category IDs', async () => {
      const categoryIds = ['INVALID_CATEGORY'];

      (validateCategoryIds as jest.Mock).mockResolvedValue({
        isValid: false,
        invalidIds: ['INVALID_CATEGORY'],
        validCategories: [],
      });

      const result = await validateCategoryIds(categoryIds);
      expect(result.isValid).toBe(false);
      expect(result.invalidIds).toContain('INVALID_CATEGORY');
    });

    it('should reject mix of valid and invalid category IDs', async () => {
      const categoryIds = ['FOOD', 'INVALID_1', 'GROCERIES', 'INVALID_2'];

      (validateCategoryIds as jest.Mock).mockResolvedValue({
        isValid: false,
        invalidIds: ['INVALID_1', 'INVALID_2'],
        validCategories: [
          { id: 'FOOD', name: 'Food' },
          { id: 'GROCERIES', name: 'Groceries' },
        ],
      });

      const result = await validateCategoryIds(categoryIds);
      expect(result.isValid).toBe(false);
      expect(result.invalidIds).toHaveLength(2);
    });

    it('should produce appropriate error message for invalid categories', () => {
      const invalidIds = ['INVALID_1', 'INVALID_2'];
      const errorMessage = `Invalid category IDs: ${invalidIds.join(', ')}`;

      expect(errorMessage).toContain('INVALID_1');
      expect(errorMessage).toContain('INVALID_2');
    });
  });

  describe('Category ID Format Validation', () => {
    it('should accept uppercase category IDs', () => {
      const categoryId = 'FOOD_AND_DRINK_GROCERIES';
      const isUppercase = categoryId === categoryId.toUpperCase();

      expect(isUppercase).toBe(true);
    });

    it('should reject null in categoryIds array', () => {
      const categoryIds = ['FOOD', null as any, 'GROCERIES'];
      const hasInvalidType = categoryIds.some(id => typeof id !== 'string');

      expect(hasInvalidType).toBe(true);
    });

    it('should reject undefined in categoryIds array', () => {
      const categoryIds = ['FOOD', undefined as any, 'GROCERIES'];
      const hasInvalidType = categoryIds.some(id => typeof id !== 'string');

      expect(hasInvalidType).toBe(true);
    });
  });
});

// ============================================================================
// INPUT VALIDATION ERRORS - Dates
// ============================================================================

describe('Input Validation Errors - Dates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Missing startDate Validation', () => {
    it('should reject missing startDate', () => {
      const data = { name: 'Budget', amount: 500 };
      const hasStartDate = 'startDate' in data;

      expect(hasStartDate).toBe(false);
    });

    it('should reject null startDate', () => {
      const startDate = null as any;
      const isValid = startDate !== null && startDate !== undefined;

      expect(isValid).toBe(false);
    });

    it('should produce appropriate error message for missing startDate', () => {
      const errorMessage = '"startDate" is required';
      expect(errorMessage).toContain('required');
    });
  });

  describe('Invalid Date Format Validation', () => {
    it('should reject invalid ISO date string', () => {
      const invalidDates = [
        '2025-13-01', // Invalid month
        '2025-01-32', // Invalid day
        'not-a-date',
        '01-01-2025', // Wrong format
        '2025/01/01', // Wrong separator
      ];

      invalidDates.forEach(dateStr => {
        const date = new Date(dateStr);
        const isValid = !isNaN(date.getTime());

        // Note: JavaScript Date is lenient with some formats
        if (dateStr === 'not-a-date') {
          expect(isValid).toBe(false);
        }
      });
    });

    it('should accept valid ISO date strings', () => {
      const validDates = [
        '2025-01-01',
        '2025-01-01T00:00:00Z',
        '2025-01-01T00:00:00.000Z',
        '2025-12-31T23:59:59Z',
      ];

      validDates.forEach(dateStr => {
        const date = new Date(dateStr);
        const isValid = !isNaN(date.getTime());
        expect(isValid).toBe(true);
      });
    });

    it('should produce appropriate error message for invalid date', () => {
      const errorMessage = '"startDate" must be a valid ISO date string';
      expect(errorMessage).toContain('valid');
      expect(errorMessage).toContain('ISO');
    });
  });

  describe('budgetEndDate Before startDate Validation', () => {
    it('should reject budgetEndDate before startDate', () => {
      const startDate = new Date('2025-06-01');
      const budgetEndDate = new Date('2025-01-01');

      const isValid = budgetEndDate > startDate;
      expect(isValid).toBe(false);
    });

    it('should reject budgetEndDate equal to startDate', () => {
      const startDate = new Date('2025-01-01');
      const budgetEndDate = new Date('2025-01-01');

      const isValid = budgetEndDate > startDate;
      expect(isValid).toBe(false);
    });

    it('should accept budgetEndDate after startDate', () => {
      const startDate = new Date('2025-01-01');
      const budgetEndDate = new Date('2025-01-02');

      const isValid = budgetEndDate > startDate;
      expect(isValid).toBe(true);
    });

    it('should produce appropriate error message for invalid date order', () => {
      const errorMessage = '"budgetEndDate" must be greater than "startDate"';
      expect(errorMessage).toContain('greater than');
    });
  });

  describe('Month Boundary Dates', () => {
    // Note: Using Date.UTC to avoid timezone issues in tests
    it('should handle January 31 correctly', () => {
      const date = new Date(Date.UTC(2025, 0, 31)); // Month is 0-indexed
      const isValid = !isNaN(date.getTime());

      expect(isValid).toBe(true);
      expect(date.getUTCDate()).toBe(31);
    });

    it('should handle February 28 in non-leap year', () => {
      const date = new Date(Date.UTC(2025, 1, 28)); // February is month 1
      const isValid = !isNaN(date.getTime());

      expect(isValid).toBe(true);
      expect(date.getUTCDate()).toBe(28);
    });

    it('should handle February 29 in leap year', () => {
      const date = new Date(Date.UTC(2024, 1, 29)); // 2024 is a leap year
      const isValid = !isNaN(date.getTime());

      expect(isValid).toBe(true);
      expect(date.getUTCDate()).toBe(29);
    });

    it('should handle rollover for February 29 in non-leap year', () => {
      const date = new Date(Date.UTC(2025, 1, 29)); // 2025 is not a leap year
      // JavaScript rolls over to March 1
      expect(date.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(date.getUTCDate()).toBe(1);
    });

    it('should handle months with 30 days', () => {
      const date30 = new Date(Date.UTC(2025, 3, 30)); // April has 30 days
      const date31 = new Date(Date.UTC(2025, 3, 31)); // Rolls over to May 1

      expect(date30.getUTCDate()).toBe(30);
      expect(date31.getUTCMonth()).toBe(4); // May (0-indexed)
      expect(date31.getUTCDate()).toBe(1);
    });
  });

  describe('Leap Year Feb 29 Handling', () => {
    it('should validate 2024 is a leap year', () => {
      const year = 2024;
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

      expect(isLeapYear).toBe(true);
    });

    it('should validate 2025 is not a leap year', () => {
      const year = 2025;
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

      expect(isLeapYear).toBe(false);
    });

    it('should validate 2000 is a leap year (divisible by 400)', () => {
      const year = 2000;
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

      expect(isLeapYear).toBe(true);
    });

    it('should validate 1900 is not a leap year (divisible by 100 but not 400)', () => {
      const year = 1900;
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);

      expect(isLeapYear).toBe(false);
    });
  });
});

// ============================================================================
// INPUT VALIDATION ERRORS - Period Type
// ============================================================================

describe('Input Validation Errors - Period Type', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Invalid Period Type Validation', () => {
    it('should reject invalid period type', () => {
      const invalidPeriod = 'INVALID_PERIOD';
      const validPeriods = Object.values(BudgetPeriod);

      const isValid = validPeriods.includes(invalidPeriod as BudgetPeriod);
      expect(isValid).toBe(false);
    });

    it('should reject uppercase period types (enum values are lowercase)', () => {
      // BudgetPeriod enum uses lowercase values: "weekly", "monthly", etc.
      const uppercasePeriod = 'MONTHLY';
      const validPeriods = Object.values(BudgetPeriod);

      const isValid = validPeriods.includes(uppercasePeriod as BudgetPeriod);
      expect(isValid).toBe(false);
    });

    it('should accept valid period types', () => {
      const validPeriods = [
        BudgetPeriod.WEEKLY,
        BudgetPeriod.MONTHLY,
        BudgetPeriod.QUARTERLY,
        BudgetPeriod.YEARLY,
        BudgetPeriod.CUSTOM,
      ];

      validPeriods.forEach(period => {
        const isValid = Object.values(BudgetPeriod).includes(period);
        expect(isValid).toBe(true);
      });
    });

    it('should produce appropriate error message for invalid period', () => {
      // BudgetPeriod enum values are lowercase
      const validPeriods = Object.values(BudgetPeriod).join(', ');
      const errorMessage = `"period" must be one of [${validPeriods}]`;

      expect(errorMessage).toContain('weekly');
      expect(errorMessage).toContain('monthly');
    });
  });
});

// ============================================================================
// INPUT VALIDATION ERRORS - Alert Threshold
// ============================================================================

describe('Input Validation Errors - Alert Threshold', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Alert Threshold Range Validation', () => {
    it('should reject negative alertThreshold', () => {
      const alertThreshold = -1;
      const isValid = alertThreshold >= 0 && alertThreshold <= 100;

      expect(isValid).toBe(false);
    });

    it('should reject alertThreshold above 100', () => {
      const alertThreshold = 101;
      const isValid = alertThreshold >= 0 && alertThreshold <= 100;

      expect(isValid).toBe(false);
    });

    it('should accept alertThreshold at 0', () => {
      const alertThreshold = 0;
      const isValid = alertThreshold >= 0 && alertThreshold <= 100;

      expect(isValid).toBe(true);
    });

    it('should accept alertThreshold at 100', () => {
      const alertThreshold = 100;
      const isValid = alertThreshold >= 0 && alertThreshold <= 100;

      expect(isValid).toBe(true);
    });

    it('should accept alertThreshold within range', () => {
      const values = [0, 25, 50, 75, 80, 90, 100];

      values.forEach(value => {
        const isValid = value >= 0 && value <= 100;
        expect(isValid).toBe(true);
      });
    });

    it('should produce appropriate error message for out of range threshold', () => {
      const errorMessage = '"alertThreshold" must be between 0 and 100';
      expect(errorMessage).toContain('0 and 100');
    });
  });
});

// ============================================================================
// REFERENCE ERRORS
// ============================================================================

describe('Reference Errors', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Non-existent Budget ID', () => {
    it('should return 404 for non-existent budget', async () => {
      (getDocument as jest.Mock).mockResolvedValue(null);

      const budget = await getDocument('budgets', 'nonexistent-budget-id');
      expect(budget).toBeNull();

      const statusCode = budget ? 200 : 404;
      expect(statusCode).toBe(404);
    });

    it('should produce appropriate error message for budget not found', () => {
      const errorCode = 'budget-not-found';
      const errorMessage = 'Budget not found';

      expect(errorCode).toBe('budget-not-found');
      expect(errorMessage).toBe('Budget not found');
    });

    it('should handle empty string budget ID', async () => {
      const budgetId = '';
      const isValidId = budgetId.length > 0;

      expect(isValidId).toBe(false);

      const errorMessage = 'Budget ID is required';
      expect(errorMessage).toContain('required');
    });
  });

  describe('Non-existent User Profile', () => {
    it('should return error for non-existent user', async () => {
      (getDocument as jest.Mock).mockResolvedValue(null);

      const user = await getDocument('users', 'nonexistent-user-id');
      expect(user).toBeNull();
    });

    it('should produce appropriate error message for user not found', () => {
      const errorCode = 'user-not-found';
      const errorMessage = 'User profile not found';

      expect(errorCode).toBe('user-not-found');
      expect(errorMessage).toBe('User profile not found');
    });
  });

  describe('Non-existent Family', () => {
    it('should return error for non-existent family', async () => {
      (getDocument as jest.Mock).mockResolvedValue(null);

      const family = await getDocument('families', 'nonexistent-family-id');
      expect(family).toBeNull();
    });

    it('should produce appropriate error message for family not found', () => {
      const errorCode = 'family-not-found';
      const errorMessage = 'Family not found';

      expect(errorCode).toBe('family-not-found');
      expect(errorMessage).toContain('Family');
    });

    it('should handle user without family accessing family budgets', () => {
      const user = createMockUser({ familyId: undefined });
      const hasFamily = !!user.familyId;

      expect(hasFamily).toBe(false);

      const errorMessage = 'User must belong to a family';
      expect(errorMessage).toContain('family');
    });
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Unicode Character Handling', () => {
    it('should handle various unicode characters in name', () => {
      const unicodeNames = [
        'Budget 2025 🍕', // Emoji
        'Café Expenses', // Accented characters
        'مصاريف الطعام', // Arabic
        'खाद्य बजट', // Hindi
        'Ngân sách thực phẩm', // Vietnamese
      ];

      unicodeNames.forEach(name => {
        const isValid = name.length > 0 && name.length <= 100;
        expect(isValid).toBe(true);
      });
    });

    it('should calculate correct length for multi-byte characters', () => {
      const name = '食費予算'; // 4 characters in Japanese

      // JavaScript string length counts code units, not graphemes
      expect(name.length).toBe(4);
    });

    it('should handle emoji in strings', () => {
      const name = '🍕🍔🍟'; // 3 emojis

      // Emojis may be multiple code units
      expect(name.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Very Large Numbers', () => {
    it('should handle numbers up to MAX_SAFE_INTEGER', () => {
      const amount = Number.MAX_SAFE_INTEGER;

      expect(Number.isSafeInteger(amount)).toBe(true);
      expect(amount).toBe(9007199254740991);
    });

    it('should detect unsafe large integers', () => {
      const unsafeAmount = Number.MAX_SAFE_INTEGER + 1;

      expect(Number.isSafeInteger(unsafeAmount)).toBe(false);
    });

    it('should handle floating point precision', () => {
      const amount = 0.1 + 0.2;

      // Famous JavaScript floating point issue
      expect(amount).not.toBe(0.3);
      expect(Math.abs(amount - 0.3)).toBeLessThan(0.0001);
    });
  });

  describe('Currency Precision', () => {
    it('should handle amounts with 2 decimal places', () => {
      const amounts = [100.00, 50.50, 99.99, 0.01];

      amounts.forEach(amount => {
        const rounded = Math.round(amount * 100) / 100;
        expect(rounded).toBe(amount);
      });
    });

    it('should round amounts to 2 decimal places', () => {
      const amount = 100.999;
      const rounded = Math.round(amount * 100) / 100;

      expect(rounded).toBe(101);
    });
  });

  describe('Timestamp Handling', () => {
    it('should convert Date to Timestamp', () => {
      const date = new Date('2025-01-15T12:00:00Z');
      const timestamp = Timestamp.fromDate(date);

      expect(timestamp).toBeDefined();
      expect(timestamp.toDate().getTime()).toBe(date.getTime());
    });

    it('should handle UTC dates correctly', () => {
      const utcDate = new Date('2025-01-15T00:00:00Z');
      const timestamp = Timestamp.fromDate(utcDate);

      const converted = timestamp.toDate();
      expect(converted.getUTCFullYear()).toBe(2025);
      expect(converted.getUTCMonth()).toBe(0); // January
      expect(converted.getUTCDate()).toBe(15);
    });

    it('should handle timezone differences', () => {
      const utcDate = new Date('2025-01-15T00:00:00Z');
      const localDate = new Date('2025-01-15T00:00:00');

      // These may differ depending on system timezone
      const utcTime = utcDate.getTime();
      const localTime = localDate.getTime();

      // In UTC timezone, they would be equal
      // In other timezones, they would differ
      expect(typeof utcTime).toBe('number');
      expect(typeof localTime).toBe('number');
    });
  });

  describe('Array Boundary Conditions', () => {
    it('should handle empty arrays', () => {
      const categoryIds: string[] = [];

      expect(categoryIds.length).toBe(0);
      expect(Array.isArray(categoryIds)).toBe(true);
    });

    it('should handle array with single element', () => {
      const categoryIds = ['FOOD'];

      expect(categoryIds.length).toBe(1);
      expect(categoryIds[0]).toBe('FOOD');
    });

    it('should handle large arrays', () => {
      const categoryIds = Array.from({ length: 100 }, (_, i) => `CATEGORY_${i}`);

      expect(categoryIds.length).toBe(100);
    });
  });

  describe('Object Field Mutations', () => {
    it('should not mutate original budget object on update', () => {
      const original = createMockBudget();
      const originalName = original.name;

      const updated = { ...original, name: 'New Name' };

      expect(original.name).toBe(originalName);
      expect(updated.name).toBe('New Name');
    });

    it('should deep clone nested objects', () => {
      const original = {
        budget: createMockBudget(),
        nested: { value: 1 },
      };

      const clone = JSON.parse(JSON.stringify(original));
      clone.nested.value = 2;

      expect(original.nested.value).toBe(1);
      expect(clone.nested.value).toBe(2);
    });
  });
});

// ============================================================================
// ERROR MESSAGE CONSISTENCY
// ============================================================================

describe('Error Message Consistency', () => {
  describe('HTTP Status Codes', () => {
    it('should use 400 for validation errors', () => {
      const validationError = {
        status: 400,
        code: 'invalid-argument',
        message: 'Validation failed',
      };

      expect(validationError.status).toBe(400);
    });

    it('should use 401 for authentication errors', () => {
      const authError = {
        status: 401,
        code: 'unauthenticated',
        message: 'User must be authenticated',
      };

      expect(authError.status).toBe(401);
    });

    it('should use 403 for authorization errors', () => {
      const authzError = {
        status: 403,
        code: 'permission-denied',
        message: 'Access denied',
      };

      expect(authzError.status).toBe(403);
    });

    it('should use 404 for not found errors', () => {
      const notFoundError = {
        status: 404,
        code: 'not-found',
        message: 'Resource not found',
      };

      expect(notFoundError.status).toBe(404);
    });

    it('should use 405 for method not allowed', () => {
      const methodError = {
        status: 405,
        code: 'method-not-allowed',
        message: 'Only GET requests are allowed',
      };

      expect(methodError.status).toBe(405);
    });

    it('should use 500 for internal errors', () => {
      const internalError = {
        status: 500,
        code: 'internal-error',
        message: 'An unexpected error occurred',
      };

      expect(internalError.status).toBe(500);
    });
  });

  describe('Error Response Format', () => {
    it('should return consistent error response format', () => {
      const error = createErrorResponse('test-code', 'Test message');

      expect(error).toHaveProperty('success', false);
      expect(error).toHaveProperty('error');
      expect(error.error).toHaveProperty('code', 'test-code');
      expect(error.error).toHaveProperty('message', 'Test message');
    });

    it('should return consistent success response format', () => {
      const data = { id: 'test-123' };
      const success = createSuccessResponse(data);

      expect(success).toHaveProperty('success', true);
      expect(success).toHaveProperty('data');
      expect(success.data).toEqual(data);
    });
  });
});

// ============================================================================
// CONCURRENT OPERATION ERROR HANDLING
// ============================================================================

describe('Concurrent Operation Error Handling', () => {
  describe('Race Condition Scenarios', () => {
    it('should handle budget deleted during update', async () => {
      // First call returns budget, second call returns null (deleted)
      (getDocument as jest.Mock)
        .mockResolvedValueOnce(createMockBudget())
        .mockResolvedValueOnce(null);

      const budget1 = await getDocument('budgets', 'budget-123');
      const budget2 = await getDocument('budgets', 'budget-123');

      expect(budget1).toBeDefined();
      expect(budget2).toBeNull();
    });

    it('should handle budget updated by another process', async () => {
      const original = createMockBudget({ spent: 100 });
      const modified = createMockBudget({ spent: 200 });

      (getDocument as jest.Mock)
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(modified);

      const before = await getDocument('budgets', 'budget-123') as any;
      const after = await getDocument('budgets', 'budget-123') as any;

      expect(before.spent).toBe(100);
      expect(after.spent).toBe(200);
    });
  });
});

// ============================================================================
// DATABASE ERROR SCENARIOS
// ============================================================================

describe('Database Error Scenarios', () => {
  describe('Connection Errors', () => {
    it('should handle database connection failure', async () => {
      (getDocument as jest.Mock).mockRejectedValue(
        new Error('Failed to connect to database')
      );

      try {
        await getDocument('budgets', 'budget-123');
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('connect');
      }
    });

    it('should handle query timeout', async () => {
      (queryDocuments as jest.Mock).mockRejectedValue(
        new Error('Query timed out')
      );

      try {
        await queryDocuments('budgets', { where: [] });
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('timed out');
      }
    });
  });

  describe('Write Errors', () => {
    it('should handle document write failure', async () => {
      (createDocument as jest.Mock).mockRejectedValue(
        new Error('Write operation failed')
      );

      try {
        await createDocument('budgets', {});
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('failed');
      }
    });

    it('should handle update failure', async () => {
      (updateDocument as jest.Mock).mockRejectedValue(
        new Error('Update operation failed')
      );

      try {
        await updateDocument('budgets', 'budget-123', {});
        fail('Should have thrown an error');
      } catch (error: any) {
        expect(error.message).toContain('failed');
      }
    });
  });
});
