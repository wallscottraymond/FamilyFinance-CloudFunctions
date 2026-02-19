"use strict";
/**
 * Inflow Periods Utilities
 *
 * This module exports all utility functions for managing inflow periods,
 * including occurrence calculation, payment prediction, status tracking,
 * and transaction alignment.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUpdateInflowPeriods = exports.matchTransactionToInflowPeriod = exports.alignTransactionsToInflowPeriods = exports.InflowPeriodStatus = exports.getStatusDisplayProperties = exports.calculateInflowPeriodStatus = exports.predictPaymentsInPeriod = exports.predictNextPayment = exports.calculateAllOccurrencesInPeriod = void 0;
// Occurrence calculation
var calculateAllOccurrencesInPeriod_1 = require("./calculateAllOccurrencesInPeriod");
Object.defineProperty(exports, "calculateAllOccurrencesInPeriod", { enumerable: true, get: function () { return calculateAllOccurrencesInPeriod_1.calculateAllOccurrencesInPeriod; } });
// Payment prediction
var predictNextPayment_1 = require("./predictNextPayment");
Object.defineProperty(exports, "predictNextPayment", { enumerable: true, get: function () { return predictNextPayment_1.predictNextPayment; } });
Object.defineProperty(exports, "predictPaymentsInPeriod", { enumerable: true, get: function () { return predictNextPayment_1.predictPaymentsInPeriod; } });
// Status calculation
var calculateInflowPeriodStatus_1 = require("./calculateInflowPeriodStatus");
Object.defineProperty(exports, "calculateInflowPeriodStatus", { enumerable: true, get: function () { return calculateInflowPeriodStatus_1.calculateInflowPeriodStatus; } });
Object.defineProperty(exports, "getStatusDisplayProperties", { enumerable: true, get: function () { return calculateInflowPeriodStatus_1.getStatusDisplayProperties; } });
Object.defineProperty(exports, "InflowPeriodStatus", { enumerable: true, get: function () { return calculateInflowPeriodStatus_1.InflowPeriodStatus; } });
// Transaction alignment
var alignTransactionsToInflowPeriods_1 = require("./alignTransactionsToInflowPeriods");
Object.defineProperty(exports, "alignTransactionsToInflowPeriods", { enumerable: true, get: function () { return alignTransactionsToInflowPeriods_1.alignTransactionsToInflowPeriods; } });
Object.defineProperty(exports, "matchTransactionToInflowPeriod", { enumerable: true, get: function () { return alignTransactionsToInflowPeriods_1.matchTransactionToInflowPeriod; } });
// Period update orchestration
var runUpdateInflowPeriods_1 = require("./runUpdateInflowPeriods");
Object.defineProperty(exports, "runUpdateInflowPeriods", { enumerable: true, get: function () { return runUpdateInflowPeriods_1.runUpdateInflowPeriods; } });
//# sourceMappingURL=index.js.map