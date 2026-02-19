/**
 * Inflow Periods Utilities
 *
 * This module exports all utility functions for managing inflow periods,
 * including occurrence calculation, payment prediction, status tracking,
 * and transaction alignment.
 */
export { calculateAllOccurrencesInPeriod, OccurrenceResult } from './calculateAllOccurrencesInPeriod';
export { predictNextPayment, predictPaymentsInPeriod, PaymentPrediction } from './predictNextPayment';
export { calculateInflowPeriodStatus, getStatusDisplayProperties, InflowPeriodStatus } from './calculateInflowPeriodStatus';
export { alignTransactionsToInflowPeriods, matchTransactionToInflowPeriod, AlignmentResult, TransactionForMatching } from './alignTransactionsToInflowPeriods';
export { runUpdateInflowPeriods, InflowUpdateResult } from './runUpdateInflowPeriods';
//# sourceMappingURL=index.d.ts.map