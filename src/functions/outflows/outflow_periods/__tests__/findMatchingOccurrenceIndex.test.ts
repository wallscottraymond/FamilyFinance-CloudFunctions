/**
 * Unit Tests for findMatchingOccurrenceIndex
 *
 * Tests the helper function that matches transaction dates to occurrence indices
 *
 * Verifies:
 * - Exact date matches
 * - Close matches within tolerance
 * - Out-of-tolerance rejections
 * - Closest match selection
 * - Edge cases and validation
 */

import { Timestamp } from 'firebase-admin/firestore';
import { findMatchingOccurrenceIndex } from '../utils/matchAllTransactionsToOccurrences';

describe('findMatchingOccurrenceIndex', () => {
  // Helper to create timestamps from date strings
  const ts = (dateString: string): Timestamp => {
    return Timestamp.fromDate(new Date(dateString));
  };

  describe('Exact matches', () => {
    it('should match transaction to exact occurrence date', () => {
      const transactionDate = ts('2025-01-15');
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15'),
        ts('2025-01-22')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(2); // Index of Jan 15
    });

    it('should match to first occurrence when exact match', () => {
      const transactionDate = ts('2025-01-01');
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(0);
    });

    it('should match to last occurrence when exact match', () => {
      const transactionDate = ts('2025-01-22');
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15'),
        ts('2025-01-22')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(3);
    });
  });

  describe('Close matches within tolerance', () => {
    it('should match transaction 1 day before occurrence', () => {
      const transactionDate = ts('2025-01-14'); // 1 day before Jan 15
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15'),
        ts('2025-01-22')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(2); // Should match to Jan 15 (closest)
    });

    it('should match transaction 1 day after occurrence', () => {
      const transactionDate = ts('2025-01-16'); // 1 day after Jan 15
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15'),
        ts('2025-01-22')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(2); // Should match to Jan 15 (closest)
    });

    it('should match transaction 3 days away (at tolerance edge)', () => {
      const transactionDate = ts('2025-01-18'); // 3 days after Jan 15
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15'),
        ts('2025-01-22')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(2); // Should match to Jan 15 (within 3-day tolerance)
    });
  });

  describe('Closest match selection', () => {
    it('should select closest occurrence when multiple are within tolerance', () => {
      const transactionDate = ts('2025-01-10'); // Between Jan 8 and Jan 15
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'), // 2 days away
        ts('2025-01-15'), // 5 days away
        ts('2025-01-22')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(1); // Should match to Jan 8 (closer)
    });

    it('should handle midpoint between two occurrences', () => {
      const transactionDate = ts('2025-01-11'); // Exactly between Jan 8 and Jan 15
      const occurrenceDates = [
        ts('2025-01-08'),
        ts('2025-01-15')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      // Should match to one of them (both are 3.5 days away, but algorithm picks first encountered closest)
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });
  });

  describe('Out of tolerance', () => {
    it('should return null when transaction is >3 days from any occurrence', () => {
      const transactionDate = ts('2025-01-20'); // 5 days from Jan 15, 2 days from Jan 22
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15')
        // No Jan 22, so transaction is too far from Jan 15
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      // Should match to Jan 15 since 5 days > 3 day tolerance, but Jan 22 is not in list
      // Actually, 5 days is > tolerance, so should return null
      // Wait, let me recalculate: Jan 20 is 5 days after Jan 15, which is > 3 days
      // So it should return null
      expect(result).toBe(null);
    });

    it('should return null when transaction is before all occurrences by >3 days', () => {
      const transactionDate = ts('2024-12-25'); // >3 days before Jan 1
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(null);
    });

    it('should return null when transaction is after all occurrences by >3 days', () => {
      const transactionDate = ts('2025-02-01'); // >3 days after Jan 22
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15'),
        ts('2025-01-22')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(null);
    });
  });

  describe('Custom tolerance', () => {
    it('should respect custom tolerance of 7 days', () => {
      const transactionDate = ts('2025-01-20'); // 5 days from Jan 15
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates, 7);

      expect(result).toBe(2); // Should match to Jan 15 with 7-day tolerance
    });

    it('should respect custom tolerance of 1 day', () => {
      const transactionDate = ts('2025-01-17'); // 2 days from Jan 15
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15')
      ];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates, 1);

      expect(result).toBe(null); // 2 days is outside 1-day tolerance
    });
  });

  describe('Edge cases', () => {
    it('should return null for empty occurrence array', () => {
      const transactionDate = ts('2025-01-15');
      const occurrenceDates: Timestamp[] = [];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(null);
    });

    it('should handle single occurrence', () => {
      const transactionDate = ts('2025-01-15');
      const occurrenceDates = [ts('2025-01-15')];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(0);
    });

    it('should return null for single occurrence outside tolerance', () => {
      const transactionDate = ts('2025-01-20');
      const occurrenceDates = [ts('2025-01-15')];

      const result = findMatchingOccurrenceIndex(transactionDate, occurrenceDates);

      expect(result).toBe(null); // 5 days > 3-day tolerance
    });
  });

  describe('Same-day transactions', () => {
    it('should match multiple transactions on same day to same occurrence', () => {
      const transactionDate1 = ts('2025-01-15T10:00:00Z');
      const transactionDate2 = ts('2025-01-15T14:30:00Z');
      const occurrenceDates = [
        ts('2025-01-01'),
        ts('2025-01-08'),
        ts('2025-01-15'),
        ts('2025-01-22')
      ];

      const result1 = findMatchingOccurrenceIndex(transactionDate1, occurrenceDates);
      const result2 = findMatchingOccurrenceIndex(transactionDate2, occurrenceDates);

      expect(result1).toBe(2);
      expect(result2).toBe(2);
      expect(result1).toBe(result2); // Both should match to same occurrence
    });
  });
});
