/**
 * Inflow Periods Utilities
 *
 * This module exports all utility functions for managing inflow periods,
 * including occurrence calculation, payment prediction, status tracking,
 * and transaction alignment.
 */

// Occurrence calculation
export {
  calculateAllOccurrencesInPeriod,
  OccurrenceResult
} from './calculateAllOccurrencesInPeriod';

// Payment prediction
export {
  predictNextPayment,
  predictPaymentsInPeriod,
  PaymentPrediction
} from './predictNextPayment';

// Status calculation
export {
  calculateInflowPeriodStatus,
  getStatusDisplayProperties,
  InflowPeriodStatus
} from './calculateInflowPeriodStatus';

// Transaction alignment
export {
  alignTransactionsToInflowPeriods,
  matchTransactionToInflowPeriod,
  AlignmentResult,
  TransactionForMatching
} from './alignTransactionsToInflowPeriods';

// Period update orchestration
export {
  runUpdateInflowPeriods,
  InflowUpdateResult
} from './runUpdateInflowPeriods';
