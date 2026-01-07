"use strict";
/**
 * Groups Module - Main Export
 *
 * Comprehensive group-based sharing and collaboration system:
 * - Core group management (groups_main)
 * - Period-based group tracking (groups_periods)
 * - Aggregated group summaries (groups_summaries)
 *
 * This module enables:
 * - Creating and managing groups
 * - Sharing financial resources with groups
 * - Group-level financial summaries and analytics
 * - Multi-user collaboration on budgets, bills, and transactions
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
// === Groups Main (Core Group Management) ===
__exportStar(require("./groups_main"), exports);
// === Groups Periods (Period-Based Tracking) ===
__exportStar(require("./groups_periods"), exports);
// === Groups Summaries (Aggregated Data) ===
__exportStar(require("./groups_summaries"), exports);
//# sourceMappingURL=index.js.map