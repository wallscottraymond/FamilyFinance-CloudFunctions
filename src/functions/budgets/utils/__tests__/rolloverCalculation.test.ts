/**
 * Unit tests for rolloverCalculation utility
 *
 * Tests the core rollover calculation functions:
 * - getEffectiveRolloverSettings: Setting resolution with budget/user overrides
 * - calculateRolloverForPeriod: Main rollover calculation logic
 * - calculateEffectiveRemaining: Remaining amount calculation
 * - findPreviousPeriodOfSameType: Period chain navigation
 * - isPeriodInPast: Period timing checks
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  getEffectiveRolloverSettings,
  calculateRolloverForPeriod,
  calculateEffectiveRemaining,
  findPreviousPeriodOfSameType,
  isPeriodInPast,
  ResolvedRolloverSettings,
} from '../rolloverCalculation';
import { Budget, BudgetPeriodDocument, PeriodType, FinancialSettings } from '../../../../types';

// Helper to create mock budget
const createMockBudget = (overrides: Partial<Budget> = {}): Budget => ({
  id: 'budget-123',
  userId: 'user-123',
  groupIds: [],
  name: 'Test Budget',
  description: 'Test description',
  amount: 500,
  currency: 'USD',
  categoryIds: ['cat-1'],
  period: 'monthly',
  alertThreshold: 80,
  isActive: true,
  isOngoing: true,
  budgetType: 'recurring',
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides,
} as Budget);

// Helper to create mock budget period
const createMockPeriod = (overrides: Partial<BudgetPeriodDocument> = {}): BudgetPeriodDocument => ({
  id: 'period-123',
  budgetId: 'budget-456',
  budgetName: 'Test Budget',
  periodId: '2025M01',
  sourcePeriodId: '2025M01',
  periodType: PeriodType.MONTHLY,
  periodStart: Timestamp.fromDate(new Date('2025-01-01')),
  periodEnd: Timestamp.fromDate(new Date('2025-01-31')),
  allocatedAmount: 500,
  originalAmount: 500,
  spent: 0,
  remaining: 500,
  isModified: false,
  checklistItems: [],
  lastCalculated: Timestamp.now(),
  isActive: true,
  userId: 'user-123',
  groupIds: [],
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides,
});

describe('getEffectiveRolloverSettings', () => {
  describe('default values', () => {
    test('should return defaults when no settings provided', () => {
      const budget = createMockBudget();
      const result = getEffectiveRolloverSettings(budget);

      expect(result.enabled).toBe(true);
      expect(result.strategy).toBe('spread');
      expect(result.spreadPeriods).toBe(3);
    });
  });

  describe('global user settings', () => {
    test('should use user financial settings when budget has no overrides', () => {
      const budget = createMockBudget();
      const userSettings: Partial<FinancialSettings> = {
        budgetRolloverEnabled: false,
        budgetRolloverStrategy: 'immediate',
        budgetRolloverSpreadPeriods: 5,
      };

      const result = getEffectiveRolloverSettings(budget, userSettings);

      expect(result.enabled).toBe(false);
      expect(result.strategy).toBe('immediate');
      expect(result.spreadPeriods).toBe(5);
    });
  });

  describe('per-budget overrides', () => {
    test('should use budget settings over user settings', () => {
      const budget = createMockBudget({
        rolloverEnabled: true,
        rolloverStrategy: 'spread',
        rolloverSpreadPeriods: 2,
      });
      const userSettings: Partial<FinancialSettings> = {
        budgetRolloverEnabled: false,
        budgetRolloverStrategy: 'immediate',
        budgetRolloverSpreadPeriods: 5,
      };

      const result = getEffectiveRolloverSettings(budget, userSettings);

      expect(result.enabled).toBe(true);
      expect(result.strategy).toBe('spread');
      expect(result.spreadPeriods).toBe(2);
    });

    test('should allow budget to explicitly disable rollover', () => {
      const budget = createMockBudget({
        rolloverEnabled: false,
      });
      const userSettings: Partial<FinancialSettings> = {
        budgetRolloverEnabled: true,
      };

      const result = getEffectiveRolloverSettings(budget, userSettings);

      expect(result.enabled).toBe(false);
    });
  });

  describe('spread periods validation', () => {
    test('should cap spread periods at 6', () => {
      const budget = createMockBudget({
        rolloverSpreadPeriods: 10,
      });

      const result = getEffectiveRolloverSettings(budget);

      expect(result.spreadPeriods).toBe(6);
    });

    test('should enforce minimum of 1 spread period', () => {
      const budget = createMockBudget({
        rolloverSpreadPeriods: 0,
      });

      const result = getEffectiveRolloverSettings(budget);

      expect(result.spreadPeriods).toBe(1);
    });

    test('should handle negative spread periods', () => {
      const budget = createMockBudget({
        rolloverSpreadPeriods: -5,
      });

      const result = getEffectiveRolloverSettings(budget);

      expect(result.spreadPeriods).toBe(1);
    });
  });
});

describe('calculateRolloverForPeriod', () => {
  const enabledSettings: ResolvedRolloverSettings = {
    enabled: true,
    strategy: 'immediate',
    spreadPeriods: 3,
  };

  const disabledSettings: ResolvedRolloverSettings = {
    enabled: false,
    strategy: 'immediate',
    spreadPeriods: 3,
  };

  const spreadSettings: ResolvedRolloverSettings = {
    enabled: true,
    strategy: 'spread',
    spreadPeriods: 3,
  };

  describe('disabled rollover', () => {
    test('should return zero rollover when disabled', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        spent: 400,
        allocatedAmount: 500,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, disabledSettings);

      expect(result.rolledOverAmount).toBe(0);
      expect(result.rolledOverFromPeriodId).toBeNull();
      expect(result.pendingRolloverDeduction).toBe(0);
      expect(result.pendingRolloverPeriods).toBe(0);
    });
  });

  describe('no previous period', () => {
    test('should return zero rollover for first period', () => {
      const currentPeriod = createMockPeriod();

      const result = calculateRolloverForPeriod(currentPeriod, null, enabledSettings);

      expect(result.rolledOverAmount).toBe(0);
      expect(result.rolledOverFromPeriodId).toBeNull();
    });
  });

  describe('underspend (surplus)', () => {
    test('should carry forward positive surplus', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 450,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, enabledSettings);

      expect(result.rolledOverAmount).toBe(50);
      expect(result.rolledOverFromPeriodId).toBe('prev-period');
      expect(result.pendingRolloverDeduction).toBe(0);
      expect(result.pendingRolloverPeriods).toBe(0);
    });

    test('should handle zero spending (full surplus)', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 0,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, enabledSettings);

      expect(result.rolledOverAmount).toBe(500);
    });

    test('should include previous rollover in surplus calculation', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        rolledOverAmount: 100, // Had +100 rollover
        spent: 400, // Spent 400 of effective 600
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, enabledSettings);

      // Effective was 600 (500 + 100), spent 400, surplus = 200
      expect(result.rolledOverAmount).toBe(200);
    });
  });

  describe('overspend (deficit) - immediate strategy', () => {
    test('should apply full deficit immediately', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 600,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, enabledSettings);

      expect(result.rolledOverAmount).toBe(-100);
      expect(result.pendingRolloverDeduction).toBe(0);
      expect(result.pendingRolloverPeriods).toBe(0);
    });

    test('should handle large overspend', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 1000,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, enabledSettings);

      expect(result.rolledOverAmount).toBe(-500);
    });
  });

  describe('overspend (deficit) - spread strategy', () => {
    test('should spread deficit across multiple periods', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 800, // Overspent by 300
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, spreadSettings);

      // 300 deficit / 3 periods = 100 per period
      expect(result.rolledOverAmount).toBe(-100);
      expect(result.pendingRolloverDeduction).toBe(200);
      expect(result.pendingRolloverPeriods).toBe(2);
    });

    test('should handle exact division in spread', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 650, // Overspent by 150
      });

      const settings: ResolvedRolloverSettings = {
        enabled: true,
        strategy: 'spread',
        spreadPeriods: 3,
      };

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, settings);

      // 150 / 3 = 50 per period
      expect(result.rolledOverAmount).toBe(-50);
      expect(result.pendingRolloverDeduction).toBe(100);
      expect(result.pendingRolloverPeriods).toBe(2);
    });
  });

  describe('continuing spread from prior periods', () => {
    test('should add prior pending deduction to current rollover', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 500, // No surplus/deficit this period
        pendingRolloverDeduction: 200, // Prior spread still active
        pendingRolloverPeriods: 2,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, spreadSettings);

      // Prior deduction: 200 / 2 = 100 this period
      expect(result.rolledOverAmount).toBe(-100);
      expect(result.pendingRolloverDeduction).toBe(100);
      expect(result.pendingRolloverPeriods).toBe(1);
    });

    test('should combine new overspend with prior spread', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        spent: 600, // Overspent by 100 this period
        pendingRolloverDeduction: 150, // Prior spread
        pendingRolloverPeriods: 3,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, spreadSettings);

      // New: 100 / 3 = 33.33
      // Prior: 150 / 3 = 50
      // Total: -83.33
      expect(result.rolledOverAmount).toBeCloseTo(-83.33, 1);
    });
  });

  describe('modified amounts', () => {
    test('should use modifiedAmount when present', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        modifiedAmount: 600, // User increased budget
        spent: 500,
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, enabledSettings);

      // Effective was 600, spent 500, surplus = 100
      expect(result.rolledOverAmount).toBe(100);
    });
  });

  describe('negative rollover from previous period', () => {
    test('should include negative rollover in effective amount', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 500,
        rolledOverAmount: -100, // Had -100 rollover from before
        spent: 450, // Spent 450 of effective 400
      });

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, enabledSettings);

      // Effective was 400 (500 - 100), spent 450, deficit = 50
      expect(result.rolledOverAmount).toBe(-50);
    });
  });

  describe('rounding', () => {
    test('should round to 2 decimal places', () => {
      const currentPeriod = createMockPeriod();
      const previousPeriod = createMockPeriod({
        id: 'prev-period',
        allocatedAmount: 100,
        spent: 133, // Overspent by 33
      });

      const settings: ResolvedRolloverSettings = {
        enabled: true,
        strategy: 'spread',
        spreadPeriods: 3,
      };

      const result = calculateRolloverForPeriod(currentPeriod, previousPeriod, settings);

      // 33 / 3 = 11
      expect(result.rolledOverAmount).toBe(-11);
    });
  });
});

describe('calculateEffectiveRemaining', () => {
  test('should calculate remaining without rollover', () => {
    const period = createMockPeriod({
      allocatedAmount: 500,
      spent: 300,
    });

    const result = calculateEffectiveRemaining(period);

    expect(result).toBe(200);
  });

  test('should include positive rollover in remaining', () => {
    const period = createMockPeriod({
      allocatedAmount: 500,
      rolledOverAmount: 100,
      spent: 300,
    });

    const result = calculateEffectiveRemaining(period);

    expect(result).toBe(300); // 500 + 100 - 300
  });

  test('should include negative rollover in remaining', () => {
    const period = createMockPeriod({
      allocatedAmount: 500,
      rolledOverAmount: -200,
      spent: 300,
    });

    const result = calculateEffectiveRemaining(period);

    expect(result).toBe(0); // 500 - 200 - 300
  });

  test('should allow negative remaining', () => {
    const period = createMockPeriod({
      allocatedAmount: 500,
      rolledOverAmount: -300,
      spent: 300,
    });

    const result = calculateEffectiveRemaining(period);

    expect(result).toBe(-100); // 500 - 300 - 300
  });

  test('should use modifiedAmount when present', () => {
    const period = createMockPeriod({
      allocatedAmount: 500,
      modifiedAmount: 600,
      rolledOverAmount: 50,
      spent: 400,
    });

    const result = calculateEffectiveRemaining(period);

    expect(result).toBe(250); // 600 + 50 - 400
  });

  test('should handle undefined spent', () => {
    const period = createMockPeriod({
      allocatedAmount: 500,
      spent: undefined,
    });

    const result = calculateEffectiveRemaining(period);

    expect(result).toBe(500);
  });
});

describe('findPreviousPeriodOfSameType', () => {
  const jan2025 = Timestamp.fromDate(new Date('2025-01-01'));
  const jan2025End = Timestamp.fromDate(new Date('2025-01-31'));
  const feb2025 = Timestamp.fromDate(new Date('2025-02-01'));
  const feb2025End = Timestamp.fromDate(new Date('2025-02-28'));
  const mar2025 = Timestamp.fromDate(new Date('2025-03-01'));
  const mar2025End = Timestamp.fromDate(new Date('2025-03-31'));

  test('should find previous period of same type', () => {
    const currentPeriod = createMockPeriod({
      id: 'feb-period',
      periodType: PeriodType.MONTHLY,
      periodStart: feb2025,
      periodEnd: feb2025End,
    });

    const periods = [
      createMockPeriod({
        id: 'jan-period',
        periodType: PeriodType.MONTHLY,
        periodStart: jan2025,
        periodEnd: jan2025End,
      }),
      currentPeriod,
    ];

    const result = findPreviousPeriodOfSameType(periods, currentPeriod);

    expect(result?.id).toBe('jan-period');
  });

  test('should return null when no previous period exists', () => {
    const currentPeriod = createMockPeriod({
      id: 'jan-period',
      periodType: PeriodType.MONTHLY,
      periodStart: jan2025,
      periodEnd: jan2025End,
    });

    const result = findPreviousPeriodOfSameType([currentPeriod], currentPeriod);

    expect(result).toBeNull();
  });

  test('should ignore periods of different types', () => {
    const currentPeriod = createMockPeriod({
      id: 'monthly-feb',
      periodType: PeriodType.MONTHLY,
      periodStart: feb2025,
      periodEnd: feb2025End,
    });

    const periods = [
      createMockPeriod({
        id: 'weekly-jan',
        periodType: PeriodType.WEEKLY,
        periodStart: jan2025,
        periodEnd: Timestamp.fromDate(new Date('2025-01-07')),
      }),
      currentPeriod,
    ];

    const result = findPreviousPeriodOfSameType(periods, currentPeriod);

    expect(result).toBeNull();
  });

  test('should return most recent previous period', () => {
    const currentPeriod = createMockPeriod({
      id: 'mar-period',
      periodType: PeriodType.MONTHLY,
      periodStart: mar2025,
      periodEnd: mar2025End,
    });

    const periods = [
      createMockPeriod({
        id: 'jan-period',
        periodType: PeriodType.MONTHLY,
        periodStart: jan2025,
        periodEnd: jan2025End,
      }),
      createMockPeriod({
        id: 'feb-period',
        periodType: PeriodType.MONTHLY,
        periodStart: feb2025,
        periodEnd: feb2025End,
      }),
      currentPeriod,
    ];

    const result = findPreviousPeriodOfSameType(periods, currentPeriod);

    expect(result?.id).toBe('feb-period');
  });

  test('should not include current period as previous', () => {
    const currentPeriod = createMockPeriod({
      id: 'current',
      periodType: PeriodType.MONTHLY,
      periodStart: jan2025,
      periodEnd: jan2025End,
    });

    const result = findPreviousPeriodOfSameType([currentPeriod], currentPeriod);

    expect(result).toBeNull();
  });
});

describe('isPeriodInPast', () => {
  test('should return true for period in past', () => {
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 10);

    const period = createMockPeriod({
      periodEnd: Timestamp.fromDate(pastDate),
    });

    const result = isPeriodInPast(period);

    expect(result).toBe(true);
  });

  test('should return false for current period', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);

    const period = createMockPeriod({
      periodEnd: Timestamp.fromDate(futureDate),
    });

    const result = isPeriodInPast(period);

    expect(result).toBe(false);
  });

  test('should return false for period ending today', () => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    const period = createMockPeriod({
      periodEnd: Timestamp.fromDate(today),
    });

    const result = isPeriodInPast(period);

    expect(result).toBe(false);
  });
});
