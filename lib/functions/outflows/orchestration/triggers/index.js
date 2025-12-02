"use strict";
/**
 * Outflows Firestore Triggers
 *
 * Exports all Firestore trigger functions for outflows
 *
 * NOTE: Summary update triggers have been moved to the centralized
 * Period-Centric Summary System at /functions/summaries/triggers/
 * Do NOT re-export them here to avoid duplicate trigger executions.
 *
 * NOTE: Trigger files have been moved to their respective module directories:
 * - onOutflowCreated → outflow_main/triggers/
 * - onOutflowUpdated → outflow_main/triggers/
 * - onOutflowPeriodCreate → outflow_periods/triggers/
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
__exportStar(require("../../outflow_main/triggers/onOutflowCreated"), exports);
__exportStar(require("../../outflow_main/triggers/onOutflowUpdated"), exports);
__exportStar(require("../../outflow_periods/triggers/onOutflowPeriodCreate"), exports);
// OLD Summary Triggers - REMOVED (now in /functions/summaries/triggers/)
// Exported from centralized location to prevent duplicate trigger executions
// export * from '../summaryTriggers/onOutflowPeriodCreatedSummary';
// export * from '../summaryTriggers/onOutflowPeriodUpdatedSummary';
// export * from '../summaryTriggers/onOutflowPeriodDeletedSummary';
// export * from '../summaryTriggers/onOutflowUpdatedSummary';
//# sourceMappingURL=index.js.map