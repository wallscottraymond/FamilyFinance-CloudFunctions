/**
 * Calculate days in a period
 */

import { Timestamp } from "firebase-admin/firestore";
import { count_days_inclusive } from "../../../domain/budgets/period_generation.service";

/**
 * Helper function to calculate days in a period
 */
export function getDaysInPeriod(startDate: Timestamp, endDate: Timestamp): number {
  // UTC-normalized inclusive day count (Code-Health-Review M1-M4: ceil on a 23:59:59 end gave October 32 days).
  return count_days_inclusive(startDate.toDate(), endDate.toDate());
}
