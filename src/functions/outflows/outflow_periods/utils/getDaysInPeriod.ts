/**
 * Calculate days in a period
 */

import { Timestamp } from 'firebase-admin/firestore';

/**
 * Helper function to calculate days in a period
 */
export function getDaysInPeriod(startDate: Timestamp, endDate: Timestamp): number {
  const start = startDate.toDate();
  const end = endDate.toDate();
  const diffMs = end.getTime() - start.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end day
}
