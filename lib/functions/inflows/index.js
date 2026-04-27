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
 * - extendRecurringInflowPeriods: Scheduled monthly maintenance (1st at 2:00 AM UTC)
 *
 * Architecture:
 * - orchestration/triggers: Firestore triggers (Inflow period generation/updates)
 * - orchestration/scheduled: Scheduled functions (rolling window maintenance)
 * - inflow_periods/utils: Utilities for period management, alignment, prediction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InflowPeriodStatus = exports.runUpdateInflowPeriods = exports.calculateInflowPeriodStatus = exports.predictPaymentsInPeriod = exports.predictNextPayment = exports.matchTransactionToInflowPeriod = exports.alignTransactionsToInflowPeriods = exports.createManualInflow = exports.updateInflowConfiguration = exports.adminRegenerateInflowPeriods = exports.regenerateInflowPeriods = exports.extendRecurringInflowPeriods = exports.onInflowUpdated = exports.onInflowCreated = void 0;
// ===== Orchestration Functions =====
// Triggers
var onInflowCreated_1 = require("./orchestration/triggers/onInflowCreated");
Object.defineProperty(exports, "onInflowCreated", { enumerable: true, get: function () { return onInflowCreated_1.onInflowCreated; } });
var onInflowUpdated_1 = require("./orchestration/triggers/onInflowUpdated");
Object.defineProperty(exports, "onInflowUpdated", { enumerable: true, get: function () { return onInflowUpdated_1.onInflowUpdated; } });
// Scheduled
var extendRecurringInflowPeriods_1 = require("./orchestration/scheduled/extendRecurringInflowPeriods");
Object.defineProperty(exports, "extendRecurringInflowPeriods", { enumerable: true, get: function () { return extendRecurringInflowPeriods_1.extendRecurringInflowPeriods; } });
// API Functions
var regenerateInflowPeriods_1 = require("./inflow_periods/api/regenerateInflowPeriods");
Object.defineProperty(exports, "regenerateInflowPeriods", { enumerable: true, get: function () { return regenerateInflowPeriods_1.regenerateInflowPeriods; } });
var adminRegenerateInflowPeriods_1 = require("./inflow_periods/api/adminRegenerateInflowPeriods");
Object.defineProperty(exports, "adminRegenerateInflowPeriods", { enumerable: true, get: function () { return adminRegenerateInflowPeriods_1.adminRegenerateInflowPeriods; } });
var updateInflowConfiguration_1 = require("./inflow_periods/api/updateInflowConfiguration");
Object.defineProperty(exports, "updateInflowConfiguration", { enumerable: true, get: function () { return updateInflowConfiguration_1.updateInflowConfiguration; } });
var createManualInflow_1 = require("./inflow_periods/api/createManualInflow");
Object.defineProperty(exports, "createManualInflow", { enumerable: true, get: function () { return createManualInflow_1.createManualInflow; } });
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
 *
 * extendRecurringInflowPeriods:
 * - Purpose: Maintain rolling 1-year window of inflow periods
 * - Schedule: Monthly on 1st at 2:00 AM UTC (matches budget maintenance)
 * - Memory: 512MiB, Timeout: 300s
 * - Location: orchestration/scheduled/extendRecurringInflowPeriods.ts
 */
//# sourceMappingURL=index.js.map