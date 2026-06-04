"use strict";
/**
 * Outflows Functions Module
 *
 * Exports all outflow-related cloud functions organized by functionality
 *
 * ARCHITECTURE MIGRATION (2026-05-26):
 * - Legacy triggers (onOutflowCreated, onOutflowUpdated) are DEPRECATED
 * - New triggers are in entry/triggers/ and follow 5-layer architecture
 * - See entry/triggers/on_outflow_created.trigger.ts for the refactored version
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
// Public API functions from module-specific locations
__exportStar(require("./outflow_main/crud/createManualOutflow"), exports);
__exportStar(require("./outflow_periods/api"), exports);
// =============================================================================
// LEGACY TRIGGERS - ALL DISABLED
// =============================================================================
// Using 5-layer architecture triggers instead (entry/triggers/)
// =============================================================================
// export * from './outflow_main/triggers/onOutflowCreated';  // Replaced by on_outflow_created
// export * from './outflow_main/triggers/onOutflowUpdated';  // DISABLED - causes cascade via runUpdateOutflowPeriods
// =============================================================================
// OUTFLOW PERIOD TRIGGERS - ALL DISABLED TO MATCH INFLOW PATTERN
// =============================================================================
// BOTH onOutflowPeriodCreate AND onOutflowPeriodUpdate triggers are disabled
// because they cause race conditions:
//
// The cascade problem:
// 1. onOutflowPeriodCreate fires for each of 50+ periods created
// 2. It runs matchAllTransactionsToOccurrences() which UPDATES each period
// 3. Each UPDATE triggers on_outflow_period_updated_summary
// 4. All those jobs run concurrently and overwrite each other
//
// Similarly:
// 1. onOutflowPeriodUpdate fires when periods are updated
// 2. It also runs matchAllTransactionsToOccurrences() which UPDATES the period
// 3. This triggers on_outflow_period_updated_summary AGAIN
// 4. Creating another race condition
//
// Inflows work because they have NO equivalent triggers.
// Summary updates are handled by the orchestrator AFTER all periods are created.
// Manual period updates are handled differently (not via these triggers).
// =============================================================================
// export * from './outflow_periods/triggers/onOutflowPeriodCreate';  // DISABLED - causes race conditions
// export * from './outflow_periods/triggers/onOutflowPeriodUpdate';  // DISABLED - causes race conditions
// Type definitions from module-specific locations
__exportStar(require("./outflow_main/types"), exports);
__exportStar(require("./outflow_periods/types"), exports);
// Dev testing functions (emulator + production)
__exportStar(require("./outflow_main/dev"), exports);
__exportStar(require("./outflow_periods/dev"), exports);
__exportStar(require("./outflow_summaries/dev"), exports);
//# sourceMappingURL=index.js.map