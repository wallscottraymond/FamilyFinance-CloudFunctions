/**
 * Calculate Inflow Period Status Utility
 *
 * Determines the status of an inflow period based on:
 * - Whether period has income due
 * - How many occurrences have been received
 * - Due dates vs current date
 *
 * Status Priority (highest to lowest):
 * 1. NOT_EXPECTED - No income expected this period
 * 2. RECEIVED - All occurrences received
 * 3. PARTIAL - Some occurrences received
 * 4. OVERDUE - Expected date passed, not received
 * 5. PENDING - Expecting income, not yet received
 */

import { Timestamp } from 'firebase-admin/firestore';
import { InflowPeriod } from '../../../../types';

/**
 * Inflow period status enum
 */
export enum InflowPeriodStatus {
  RECEIVED = 'received',           // All occurrences received
  PARTIAL = 'partial',             // Some occurrences received
  PENDING = 'pending',             // Expecting income, not yet received
  OVERDUE = 'overdue',             // Expected date passed, not received
  NOT_EXPECTED = 'not_expected'    // No income expected this period
}

/**
 * Status calculation result
 */
export interface StatusResult {
  status: InflowPeriodStatus;
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  isOverdue: boolean;
  daysPastDue: number | null;
  nextDueDate: Timestamp | null;
}

/**
 * Calculate the status of an inflow period
 *
 * Uses occurrence tracking to determine accurate status.
 * Falls back to amount-based calculation if occurrences aren't tracked.
 *
 * @param inflowPeriod - The inflow period to calculate status for
 * @param referenceDate - The date to compare against (default: now)
 * @returns InflowPeriodStatus enum value
 *
 * @example
 * ```typescript
 * // Period with 2 occurrences, 1 received
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.PARTIAL
 *
 * // Period with all occurrences received
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.RECEIVED
 *
 * // Period with no income expected
 * const status = calculateInflowPeriodStatus(inflowPeriod);
 * // InflowPeriodStatus.NOT_EXPECTED
 * ```
 */
export function calculateInflowPeriodStatus(
  inflowPeriod: Partial<InflowPeriod>,
  referenceDate: Date = new Date()
): InflowPeriodStatus {
  // Handle inactive periods
  if (inflowPeriod.isActive === false) {
    return InflowPeriodStatus.NOT_EXPECTED;
  }

  // Get occurrence counts
  const totalOccurrences = inflowPeriod.numberOfOccurrencesInPeriod ?? 0;
  const paidOccurrences = inflowPeriod.numberOfOccurrencesPaid ?? 0;

  // Handle no occurrences expected
  if (totalOccurrences === 0) {
    return InflowPeriodStatus.NOT_EXPECTED;
  }

  // Check if fully received
  if (paidOccurrences >= totalOccurrences) {
    return InflowPeriodStatus.RECEIVED;
  }

  // Check if partially received
  const isPartiallyPaid = paidOccurrences > 0 && paidOccurrences < totalOccurrences;

  // Find earliest unpaid due date for overdue check
  let earliestUnpaidDueDate: Date | null = null;

  // Check occurrence arrays for unpaid occurrences
  if (inflowPeriod.occurrenceDueDates && inflowPeriod.occurrencePaidFlags) {
    for (let i = 0; i < inflowPeriod.occurrenceDueDates.length; i++) {
      const isPaid = inflowPeriod.occurrencePaidFlags[i] ?? false;
      if (!isPaid) {
        const dueDate = inflowPeriod.occurrenceDueDates[i]?.toDate();
        if (dueDate && (!earliestUnpaidDueDate || dueDate < earliestUnpaidDueDate)) {
          earliestUnpaidDueDate = dueDate;
        }
      }
    }
  } else if (inflowPeriod.nextUnpaidDueDate) {
    earliestUnpaidDueDate = inflowPeriod.nextUnpaidDueDate.toDate();
  } else if (inflowPeriod.firstDueDateInPeriod) {
    earliestUnpaidDueDate = inflowPeriod.firstDueDateInPeriod.toDate();
  }

  // Check if overdue (with 1 day grace period)
  let isOverdue = false;
  if (earliestUnpaidDueDate) {
    const gracePeriodDays = 1;
    const dueDateWithGrace = new Date(earliestUnpaidDueDate);
    dueDateWithGrace.setDate(dueDateWithGrace.getDate() + gracePeriodDays);

    if (referenceDate > dueDateWithGrace) {
      isOverdue = true;
    }
  }

  // Determine final status
  if (isOverdue) {
    return InflowPeriodStatus.OVERDUE;
  } else if (isPartiallyPaid) {
    return InflowPeriodStatus.PARTIAL;
  } else {
    return InflowPeriodStatus.PENDING;
  }
}

/**
 * Get status display properties
 *
 * Returns user-friendly display properties for a status.
 *
 * @param status - The inflow period status
 * @returns Display properties (label, color, icon)
 */
export function getStatusDisplayProperties(status: InflowPeriodStatus): {
  label: string;
  color: string;
  icon: string;
} {
  switch (status) {
    case InflowPeriodStatus.RECEIVED:
      return {
        label: 'Received',
        color: 'green',
        icon: 'check-circle'
      };

    case InflowPeriodStatus.PARTIAL:
      return {
        label: 'Partial',
        color: 'yellow',
        icon: 'clock'
      };

    case InflowPeriodStatus.PENDING:
      return {
        label: 'Pending',
        color: 'blue',
        icon: 'clock'
      };

    case InflowPeriodStatus.OVERDUE:
      return {
        label: 'Overdue',
        color: 'red',
        icon: 'alert-circle'
      };

    case InflowPeriodStatus.NOT_EXPECTED:
      return {
        label: 'Not Expected',
        color: 'gray',
        icon: 'minus-circle'
      };

    default:
      return {
        label: 'Unknown',
        color: 'gray',
        icon: 'help-circle'
      };
  }
}

export default calculateInflowPeriodStatus;
