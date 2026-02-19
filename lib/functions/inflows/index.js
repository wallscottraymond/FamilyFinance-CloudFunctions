"use strict";
/**
 * Inflows Module - Cloud Functions
 *
 * This module provides inflow (recurring income) management for the Family Finance app,
 * including automatic inflow period generation, transaction alignment, and prediction.
 *
 * Functions included:
 * - onInflowCreated: Automatic inflow period generation trigger
 * - onInflowUpdated: Cascade inflow changes to periods trigger
 *
 * Architecture:
 * - orchestration/triggers: Firestore triggers (Inflow period generation/updates)
 * - inflow_periods/utils: Utilities for period management, alignment, prediction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InflowPeriodStatus = exports.runUpdateInflowPeriods = exports.calculateInflowPeriodStatus = exports.predictPaymentsInPeriod = exports.predictNextPayment = exports.matchTransactionToInflowPeriod = exports.alignTransactionsToInflowPeriods = exports.onInflowUpdated = exports.onInflowCreated = void 0;
// ===== Orchestration Functions =====
// Triggers
var onInflowCreated_1 = require("./orchestration/triggers/onInflowCreated");
Object.defineProperty(exports, "onInflowCreated", { enumerable: true, get: function () { return onInflowCreated_1.onInflowCreated; } });
var onInflowUpdated_1 = require("./orchestration/triggers/onInflowUpdated");
Object.defineProperty(exports, "onInflowUpdated", { enumerable: true, get: function () { return onInflowUpdated_1.onInflowUpdated; } });
// ===== Inflow Period Utilities =====
var utils_1 = require("./inflow_periods/utils");
Object.defineProperty(exports, "alignTransactionsToInflowPeriods", { enumerable: true, get: function () { return utils_1.alignTransactionsToInflowPeriods; } });
Object.defineProperty(exports, "matchTransactionToInflowPeriod", { enumerable: true, get: function () { return utils_1.matchTransactionToInflowPeriod; } });
Object.defineProperty(exports, "predictNextPayment", { enumerable: true, get: function () { return utils_1.predictNextPayment; } });
Object.defineProperty(exports, "predictPaymentsInPeriod", { enumerable: true, get: function () { return utils_1.predictPaymentsInPeriod; } });
Object.defineProperty(exports, "calculateInflowPeriodStatus", { enumerable: true, get: function () { return utils_1.calculateInflowPeriodStatus; } });
Object.defineProperty(exports, "runUpdateInflowPeriods", { enumerable: true, get: function () { return utils_1.runUpdateInflowPeriods; } });
Object.defineProperty(exports, "InflowPeriodStatus", { enumerable: true, get: function () { return utils_1.InflowPeriodStatus; } });
/**
 * Function Overview:
 *
 * onInflowCreated:
 * - Purpose: Automatically generate inflow_periods when inflow is created
 * - Also: Aligns historical transactions and calculates predictions
 * - Triggers: When document created in inflows collection
 * - Memory: 512MiB, Timeout: 60s
 * - Location: orchestration/triggers/onInflowCreated.ts
 *
 * onInflowUpdated:
 * - Purpose: Cascade inflow changes to all related inflow_periods
 * - Handles: averageAmount, userCustomName, transactionIds changes
 * - Triggers: When document updated in inflows collection
 * - Memory: 512MiB, Timeout: 60s
 * - Location: orchestration/triggers/onInflowUpdated.ts
 */
//# sourceMappingURL=index.js.map