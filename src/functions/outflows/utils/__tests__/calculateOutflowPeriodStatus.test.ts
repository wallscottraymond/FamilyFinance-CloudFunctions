/**
 * Tests for calculateOutflowPeriodStatus utility
 */

import { calculateOutflowPeriodStatus, calculateTotalPaid, getPaymentBreakdown, hasPayments } from '../calculateOutflowPeriodStatus';
import { TransactionSplitReference, PaymentType, OutflowPeriodStatus } from '../../../../types';
import * as admin from 'firebase-admin';

// Mock Firestore Timestamp
const createTimestamp = (daysFromNow: number): admin.firestore.Timestamp => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return admin.firestore.Timestamp.fromDate(date);
};

describe('calculateOutflowPeriodStatus', () => {
  const now = admin.firestore.Timestamp.now();
  const pastDate = createTimestamp(-7); // 7 days ago
  const futureDate = createTimestamp(7); // 7 days from now
  const nearFutureDate = createTimestamp(2); // 2 days from now (due soon)

  describe('Status: PAID', () => {
    it('should return PAID when fully paid after due date', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 100,
          description: 'Payment',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        }
      ];

      const status = calculateOutflowPeriodStatus(
        true, // isDuePeriod
        pastDate, // dueDate (past - already due)
        pastDate, // expectedDueDate
        100, // amountDue
        splits
      );

      expect(status).toBe(OutflowPeriodStatus.PAID);
    });

    it('should return PAID when overpaid after due date', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 150,
          description: 'Overpayment',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        }
      ];

      const status = calculateOutflowPeriodStatus(
        true,
        pastDate, // due date in past
        pastDate,
        100,
        splits
      );

      expect(status).toBe(OutflowPeriodStatus.PAID);
    });
  });

  describe('Status: PAID_EARLY', () => {
    it('should return PAID_EARLY when paid before due date', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 100,
          description: 'Early payment',
          paymentType: PaymentType.ADVANCE,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        }
      ];

      const status = calculateOutflowPeriodStatus(
        true, // isDuePeriod
        futureDate, // dueDate is in future
        futureDate,
        100,
        splits
      );

      expect(status).toBe(OutflowPeriodStatus.PAID_EARLY);
    });
  });

  describe('Status: PARTIAL', () => {
    it('should return PARTIAL when partially paid', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 50,
          description: 'Partial payment',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        }
      ];

      const status = calculateOutflowPeriodStatus(
        true,
        futureDate,
        futureDate,
        100,
        splits
      );

      expect(status).toBe(OutflowPeriodStatus.PARTIAL);
    });
  });

  describe('Status: OVERDUE', () => {
    it('should return OVERDUE when past due with no payment', () => {
      const status = calculateOutflowPeriodStatus(
        true, // isDuePeriod
        pastDate, // dueDate is in past
        pastDate,
        100,
        [] // no payments
      );

      expect(status).toBe(OutflowPeriodStatus.OVERDUE);
    });

    it('should return OVERDUE when past due with partial payment', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 30,
          description: 'Insufficient payment',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        }
      ];

      const status = calculateOutflowPeriodStatus(
        true,
        pastDate, // past due
        pastDate,
        100,
        splits
      );

      expect(status).toBe(OutflowPeriodStatus.OVERDUE);
    });
  });

  describe('Status: DUE_SOON', () => {
    it('should return DUE_SOON when due within 3 days', () => {
      const status = calculateOutflowPeriodStatus(
        true,
        nearFutureDate, // 2 days from now
        nearFutureDate,
        100,
        [] // no payments yet
      );

      expect(status).toBe(OutflowPeriodStatus.DUE_SOON);
    });
  });

  describe('Status: PENDING', () => {
    it('should return PENDING when not yet due', () => {
      const status = calculateOutflowPeriodStatus(
        true,
        futureDate, // 7 days from now
        futureDate,
        100,
        [] // no payments
      );

      expect(status).toBe(OutflowPeriodStatus.PENDING);
    });

    it('should return PENDING when not a due period', () => {
      const status = calculateOutflowPeriodStatus(
        false, // not a due period
        undefined,
        futureDate,
        0, // no amount due
        []
      );

      expect(status).toBe(OutflowPeriodStatus.PENDING);
    });
  });

  describe('Extra Principal Payments', () => {
    it('should exclude extra principal from total paid calculation', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 100,
          description: 'Regular payment',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        },
        {
          transactionId: 'txn_1',
          splitId: 'split_2',
          transactionDate: pastDate,
          amount: 50,
          description: 'Extra principal',
          paymentType: PaymentType.EXTRA_PRINCIPAL,
          isAutoMatched: false,
          matchedAt: now,
          matchedBy: 'user_123'
        }
      ];

      // Should be PAID_EARLY because regular payment covers the $100 due
      // Extra principal shouldn't count toward required payment
      // Due date is in future, so it's paid early
      const status = calculateOutflowPeriodStatus(
        true,
        futureDate,
        futureDate,
        100,
        splits
      );

      expect(status).toBe(OutflowPeriodStatus.PAID_EARLY);
    });
  });

  describe('Multiple Payment Types', () => {
    it('should handle catch-up and regular payments together', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 50,
          description: 'Catch-up payment',
          paymentType: PaymentType.CATCH_UP,
          isAutoMatched: false,
          matchedAt: now,
          matchedBy: 'user_123'
        },
        {
          transactionId: 'txn_2',
          splitId: 'split_2',
          transactionDate: pastDate,
          amount: 50,
          description: 'Regular payment',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        }
      ];

      const status = calculateOutflowPeriodStatus(
        true,
        futureDate, // due date in future
        futureDate,
        100,
        splits
      );

      expect(status).toBe(OutflowPeriodStatus.PAID_EARLY);
    });
  });
});

describe('Helper Functions', () => {
  const now = admin.firestore.Timestamp.now();
  const pastDate = createTimestamp(-7);

  describe('hasPayments', () => {
    it('should return true when splits exist', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 100,
          description: 'Payment',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        }
      ];

      expect(hasPayments(splits)).toBe(true);
    });

    it('should return false when no splits', () => {
      expect(hasPayments([])).toBe(false);
    });
  });

  describe('calculateTotalPaid', () => {
    it('should calculate total excluding extra principal', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 100,
          description: 'Regular',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        },
        {
          transactionId: 'txn_1',
          splitId: 'split_2',
          transactionDate: pastDate,
          amount: 50,
          description: 'Extra',
          paymentType: PaymentType.EXTRA_PRINCIPAL,
          isAutoMatched: false,
          matchedAt: now,
          matchedBy: 'user_123'
        }
      ];

      expect(calculateTotalPaid(splits)).toBe(100);
    });
  });

  describe('getPaymentBreakdown', () => {
    it('should break down payments by type', () => {
      const splits: TransactionSplitReference[] = [
        {
          transactionId: 'txn_1',
          splitId: 'split_1',
          transactionDate: pastDate,
          amount: 100,
          description: 'Regular',
          paymentType: PaymentType.REGULAR,
          isAutoMatched: true,
          matchedAt: now,
          matchedBy: 'system'
        },
        {
          transactionId: 'txn_2',
          splitId: 'split_2',
          transactionDate: pastDate,
          amount: 50,
          description: 'Catch-up',
          paymentType: PaymentType.CATCH_UP,
          isAutoMatched: false,
          matchedAt: now,
          matchedBy: 'user_123'
        },
        {
          transactionId: 'txn_3',
          splitId: 'split_3',
          transactionDate: pastDate,
          amount: 25,
          description: 'Extra',
          paymentType: PaymentType.EXTRA_PRINCIPAL,
          isAutoMatched: false,
          matchedAt: now,
          matchedBy: 'user_123'
        }
      ];

      const breakdown = getPaymentBreakdown(splits);

      expect(breakdown.regular).toBe(100);
      expect(breakdown.catchUp).toBe(50);
      expect(breakdown.advance).toBe(0);
      expect(breakdown.extraPrincipal).toBe(25);
      expect(breakdown.total).toBe(175);
    });
  });
});
