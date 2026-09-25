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
// API callables + admin — RETIRED (Derive-Everywhere-Consistency). `user_summaries` is no longer
// built or read (period nav = `source_periods`, financials = derive-on-read), so these deployed
// endpoints had NO live caller (getUserPeriodSummary/recalculate/regenerate were only reachable via
// the retired FE service + a devtool button; backfill was a one-off). Files deleted; un-deployed via
// `firebase functions:delete`. The 3 period-summary triggers were already un-exported (build is off).
// Reversible: restore from git + the enqueue chokepoint in update_user_summary.orchestrator.
// Export types
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map