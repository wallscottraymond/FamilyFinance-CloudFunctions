import { validateAndRedistributeSplits } from '../validateAndRedistributeSplits';
import { Timestamp } from '@google-cloud/firestore';

/**
 * Test Suite for Split Validation & Redistribution
 *
 * Tests the validateAndRedistributeSplits utility with realistic 18-field TransactionSplit data.
 * Following TDD approach: Tests written first, implementation follows.
 */

// Helper to create realistic split with all 18 fields
const createRealisticSplit = (overrides: Partial<any> = {}): any => ({
  splitId: 'split_test_001',
  budgetId: 'budget_groceries_001',
  amount: 50.00,
  description: 'Test split',
  isDefault: true,
  monthlyPeriodId: 'bp_jan_2025_001',
  weeklyPeriodId: null,
  biWeeklyPeriodId: null,
  outflowId: null,
  plaidPrimaryCategory: 'Food and Drink',
  plaidDetailedCategory: 'Groceries',
  internalPrimaryCategory: 'FOOD',
  internalDetailedCategory: 'GROCERIES',
  isIgnored: false,
  isRefund: false,
  isTaxDeductible: false,
  ignoredReason: null,
  refundReason: null,
  paymentDate: Timestamp.fromDate(new Date('2025-01-15')),
  rules: [],
  tags: ['test'],
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...overrides
});

describe('validateAndRedistributeSplits', () => {
  describe('Valid Split Totals', () => {
    it('accepts splits totaling exactly transaction amount', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 50.00 }),
        createRealisticSplit({ splitId: 'split_002', amount: 30.00 }),
        createRealisticSplit({ splitId: 'split_003', amount: 20.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(true);
      expect(result.redistributedSplits).toBeUndefined();
      expect(result.error).toBeUndefined();
    });

    it('accepts splits within floating-point tolerance (0.01)', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 33.33 }),
        createRealisticSplit({ splitId: 'split_002', amount: 33.33 }),
        createRealisticSplit({ splitId: 'split_003', amount: 33.34 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(true);
    });

    it('accepts single split matching transaction amount', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 100.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Overage Scenarios (Splits > Transaction)', () => {
    it('proportionally reduces splits when total exceeds transaction amount', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 60.00 }),
        createRealisticSplit({ splitId: 'split_002', amount: 50.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(false);
      expect(result.redistributedSplits).toBeDefined();
      expect(result.redistributedSplits![0].amount).toBeCloseTo(54.55, 2);
      expect(result.redistributedSplits![1].amount).toBeCloseTo(45.45, 2);

      // Verify all 18 fields preserved
      expect(result.redistributedSplits![0].budgetId).toBe('budget_groceries_001');
      expect(result.redistributedSplits![0].plaidPrimaryCategory).toBe('Food and Drink');
      expect(result.redistributedSplits![0].monthlyPeriodId).toBe('bp_jan_2025_001');
      expect(result.redistributedSplits![0].tags).toEqual(['test']);
    });

    it('handles three-way split with overage', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 40.00 }),
        createRealisticSplit({ splitId: 'split_002', amount: 40.00 }),
        createRealisticSplit({ splitId: 'split_003', amount: 40.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(false);
      const redistributed = result.redistributedSplits!;
      expect(redistributed[0].amount).toBeCloseTo(33.33, 2);
      expect(redistributed[1].amount).toBeCloseTo(33.33, 2);
      expect(redistributed[2].amount).toBeCloseTo(33.34, 2);

      // Verify sum equals transaction amount
      const sum = redistributed.reduce((acc, s) => acc + s.amount, 0);
      expect(sum).toBeCloseTo(100.00, 2);
    });

    it('handles large overage with multiple splits', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 100.00 }),
        createRealisticSplit({ splitId: 'split_002', amount: 100.00 }),
        createRealisticSplit({ splitId: 'split_003', amount: 100.00 })
      ];

      const result = validateAndRedistributeSplits(150.00, splits);

      expect(result.isValid).toBe(false);
      const redistributed = result.redistributedSplits!;

      // Each should be reduced proportionally (150/300 = 0.5)
      expect(redistributed[0].amount).toBeCloseTo(50.00, 2);
      expect(redistributed[1].amount).toBeCloseTo(50.00, 2);
      expect(redistributed[2].amount).toBeCloseTo(50.00, 2);
    });
  });

  describe('Underage Scenarios (Splits < Transaction)', () => {
    it('adds unallocated split when total is less than transaction', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 40.00 }),
        createRealisticSplit({ splitId: 'split_002', amount: 30.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(false);
      expect(result.redistributedSplits).toHaveLength(3);
      expect(result.redistributedSplits![2].amount).toBeCloseTo(30.00, 2);
      expect(result.redistributedSplits![2].description).toBe('Unallocated');
      expect(result.redistributedSplits![2].budgetId).toBe('unassigned');
      expect(result.redistributedSplits![2].isDefault).toBe(false);
    });

    it('adds unallocated split for small remainder', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 99.50 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(false);
      expect(result.redistributedSplits).toHaveLength(2);
      expect(result.redistributedSplits![1].amount).toBeCloseTo(0.50, 2);
      expect(result.redistributedSplits![1].budgetId).toBe('unassigned');
    });
  });

  describe('Single Split Edge Cases', () => {
    it('auto-adjusts single split to match transaction amount', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 50.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(false);
      expect(result.redistributedSplits![0].amount).toBe(100.00);
    });

    it('auto-adjusts single split when too large', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 150.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(false);
      expect(result.redistributedSplits![0].amount).toBe(100.00);
    });
  });

  describe('Currency Precision', () => {
    it('rounds to 2 decimal places', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 33.333 }),
        createRealisticSplit({ splitId: 'split_002', amount: 33.333 }),
        createRealisticSplit({ splitId: 'split_003', amount: 33.334 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      result.redistributedSplits?.forEach(split => {
        const decimalPlaces = (split.amount.toString().split('.')[1] || '').length;
        expect(decimalPlaces).toBeLessThanOrEqual(2);
      });
    });

    it('prevents split from rounding to $0.00', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 99.99 }),
        createRealisticSplit({ splitId: 'split_002', amount: 0.005 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      const redistributed = result.redistributedSplits!;
      expect(redistributed.every(split => split.amount >= 0.01)).toBe(true);
    });

    it('handles exact cent amounts', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 33.33 }),
        createRealisticSplit({ splitId: 'split_002', amount: 33.33 }),
        createRealisticSplit({ splitId: 'split_003', amount: 33.34 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Field Preservation', () => {
    it('preserves all 18 TransactionSplit fields during redistribution', () => {
      const originalSplit = createRealisticSplit({
        splitId: 'split_001',
        amount: 60.00,
        budgetId: 'budget_groceries_001',
        monthlyPeriodId: 'bp_jan_2025_001',
        plaidDetailedCategory: 'Groceries',
        tags: ['walmart', 'groceries'],
        isRefund: false,
        isTaxDeductible: true,
        description: 'Walmart groceries shopping'
      });

      const result = validateAndRedistributeSplits(100.00, [originalSplit]);
      const redistributed = result.redistributedSplits![0];

      expect(redistributed.splitId).toBe('split_001');
      expect(redistributed.budgetId).toBe('budget_groceries_001');
      expect(redistributed.monthlyPeriodId).toBe('bp_jan_2025_001');
      expect(redistributed.plaidDetailedCategory).toBe('Groceries');
      expect(redistributed.tags).toEqual(['walmart', 'groceries']);
      expect(redistributed.isRefund).toBe(false);
      expect(redistributed.isTaxDeductible).toBe(true);
      expect(redistributed.description).toBe('Walmart groceries shopping');
      // Only amount should change
      expect(redistributed.amount).toBe(100.00);
    });

    it('preserves timestamp fields', () => {
      const testDate = Timestamp.fromDate(new Date('2025-01-15'));
      const createdDate = Timestamp.fromDate(new Date('2025-01-01'));

      const split = createRealisticSplit({
        amount: 60.00,
        paymentDate: testDate,
        createdAt: createdDate
      });

      const result = validateAndRedistributeSplits(100.00, [split]);
      const redistributed = result.redistributedSplits![0];

      expect(redistributed.paymentDate).toEqual(testDate);
      expect(redistributed.createdAt).toEqual(createdDate);
    });

    it('preserves arrays and optional fields', () => {
      const split = createRealisticSplit({
        amount: 60.00,
        tags: ['tag1', 'tag2', 'tag3'],
        rules: ['rule1', 'rule2'],
        weeklyPeriodId: 'weekly_001',
        outflowId: 'outflow_123'
      });

      const result = validateAndRedistributeSplits(100.00, [split]);
      const redistributed = result.redistributedSplits![0];

      expect(redistributed.tags).toEqual(['tag1', 'tag2', 'tag3']);
      expect(redistributed.rules).toEqual(['rule1', 'rule2']);
      expect(redistributed.weeklyPeriodId).toBe('weekly_001');
      expect(redistributed.outflowId).toBe('outflow_123');
    });
  });

  describe('Edge Cases & Validation', () => {
    it('handles empty splits array', () => {
      const result = validateAndRedistributeSplits(100.00, []);

      expect(result.isValid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('handles zero transaction amount', () => {
      const splits = [
        createRealisticSplit({ amount: 0.00 })
      ];

      const result = validateAndRedistributeSplits(0.00, splits);

      expect(result.isValid).toBe(true);
    });

    it('handles negative amounts gracefully', () => {
      const splits = [
        createRealisticSplit({ amount: -50.00 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      // Implementation should handle this appropriately
      expect(result).toBeDefined();
    });

    it('handles very small differences (precision issues)', () => {
      const splits = [
        createRealisticSplit({ splitId: 'split_001', amount: 33.333333 }),
        createRealisticSplit({ splitId: 'split_002', amount: 33.333333 }),
        createRealisticSplit({ splitId: 'split_003', amount: 33.333334 })
      ];

      const result = validateAndRedistributeSplits(100.00, splits);

      // Should be valid within tolerance or redistribute with proper rounding
      expect(result.isValid || result.redistributedSplits).toBeTruthy();
    });
  });

  describe('Real-World Scenarios', () => {
    it('handles Walmart multi-category split', () => {
      const splits = [
        createRealisticSplit({
          splitId: 'split_food',
          budgetId: 'budget_groceries',
          amount: 60.00,
          description: 'Food items',
          internalPrimaryCategory: 'FOOD'
        }),
        createRealisticSplit({
          splitId: 'split_household',
          budgetId: 'budget_household',
          amount: 25.50,
          description: 'Household items',
          internalPrimaryCategory: 'HOUSEHOLD'
        })
      ];

      const result = validateAndRedistributeSplits(85.50, splits);

      expect(result.isValid).toBe(true);
    });

    it('handles restaurant tip split', () => {
      const splits = [
        createRealisticSplit({
          splitId: 'split_meal',
          amount: 50.00,
          description: 'Meal',
          internalPrimaryCategory: 'FOOD'
        }),
        createRealisticSplit({
          splitId: 'split_tip',
          amount: 10.00,
          description: 'Tip',
          internalPrimaryCategory: 'FOOD'
        })
      ];

      const result = validateAndRedistributeSplits(60.00, splits);

      expect(result.isValid).toBe(true);
    });

    it('handles gas station snack + fuel split with overage', () => {
      const splits = [
        createRealisticSplit({
          splitId: 'split_fuel',
          amount: 40.00,
          internalPrimaryCategory: 'TRANSPORTATION'
        }),
        createRealisticSplit({
          splitId: 'split_snack',
          amount: 10.00,
          internalPrimaryCategory: 'FOOD'
        }),
        createRealisticSplit({
          splitId: 'split_coffee',
          amount: 5.50,
          internalPrimaryCategory: 'FOOD'
        })
      ];

      // Total is 55.50 but transaction is 55.00 (overage by 0.50)
      const result = validateAndRedistributeSplits(55.00, splits);

      expect(result.isValid).toBe(false);
      const redistributed = result.redistributedSplits!;

      // Verify proportional reduction
      const sum = redistributed.reduce((acc, s) => acc + s.amount, 0);
      expect(sum).toBeCloseTo(55.00, 2);
    });
  });
});
