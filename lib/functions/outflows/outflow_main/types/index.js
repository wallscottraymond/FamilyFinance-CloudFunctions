"use strict";
/**
 * Outflow Main Types
 *
 * Types related to the main outflow (recurring bill) entity.
 *
 * ⚠️ CRITICAL: This file defines the CORRECT structure for outflows.
 *
 * CORRECT STRUCTURE (2025-01-03):
 * - ✅ groupId: string (group association, null = private)
 * - ✅ averageAmount: number (FLAT, NOT nested!)
 * - ✅ lastAmount: number (FLAT, NOT nested!)
 * - ✅ currency: string (FLAT)
 *
 * INCORRECT LEGACY STRUCTURE (DO NOT USE):
 * - ❌ groupIds: string[] (array)
 * - ❌ accessibleBy: string[] (denormalized array)
 * - ❌ access: { nested object } (old RBAC system)
 * - ❌ averageAmount: { amount, isoCurrencyCode } (nested object)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutflowFrequency = exports.OutflowStatus = void 0;
// =======================
// OUTFLOW ENUMS
// =======================
/**
 * Outflow Status (from Plaid)
 */
var OutflowStatus;
(function (OutflowStatus) {
    OutflowStatus["MATURE"] = "MATURE";
    OutflowStatus["EARLY_DETECTION"] = "EARLY_DETECTION"; // First detection
})(OutflowStatus || (exports.OutflowStatus = OutflowStatus = {}));
/**
 * Outflow Frequency (standardized Plaid format)
 */
var OutflowFrequency;
(function (OutflowFrequency) {
    OutflowFrequency["WEEKLY"] = "WEEKLY";
    OutflowFrequency["BIWEEKLY"] = "BIWEEKLY";
    OutflowFrequency["SEMI_MONTHLY"] = "SEMI_MONTHLY";
    OutflowFrequency["MONTHLY"] = "MONTHLY";
    OutflowFrequency["ANNUALLY"] = "ANNUALLY";
})(OutflowFrequency || (exports.OutflowFrequency = OutflowFrequency = {}));
//# sourceMappingURL=index.js.map