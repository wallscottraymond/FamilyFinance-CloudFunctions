"use strict";
/**
 * Period-Centric Summary System
 *
 * This module exports all summary-related functions including:
 * - API callable functions for fetching and recalculating summaries
 * - Firestore triggers for automatic summary updates
 *
 * Architecture:
 * - user_summaries: One document per user per period containing ALL resources
 * - group_summaries: One document per group per period containing ALL resources
 *
 * Example Document ID: user123_monthly_2025-M11
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
// Export API callable functions
__exportStar(require("./api/getUserPeriodSummary"), exports);
__exportStar(require("./api/recalculateUserPeriodSummary"), exports);
__exportStar(require("./api/regenerateAllUserSummaries"), exports);
// Firestore triggers — RETIRED. The `user_summaries` materialized build is disabled: the app
// reads period nav from `source_periods` and financials via the derive-on-read path. Un-exporting
// these 6 period-summary triggers removes them from the deployed set (they do no other work).
// Reversible: restore these exports + the enqueue chokepoint in update_user_summary.orchestrator.
// export * from "./triggers/outflowPeriodSummaryTriggers";
// export * from "./triggers/budgetPeriodSummaryTriggers";
// export * from "./triggers/inflowPeriodSummaryTriggers";
// Export types
__exportStar(require("./types"), exports);
// Export admin functions
__exportStar(require("./admin/backfillUserSummaries"), exports);
//# sourceMappingURL=index.js.map