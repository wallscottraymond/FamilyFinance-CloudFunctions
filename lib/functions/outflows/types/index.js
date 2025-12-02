"use strict";
/**
 * Outflows Types - Central Re-export Hub
 *
 * This file re-exports all outflow-related types from their respective module directories.
 * Types are now organized by domain:
 *
 * - outflow_main/types/ - Main outflow entity types
 * - outflow_periods/types/ - Outflow period types
 * - outflow_summaries/types/ - Summary-related types (future)
 *
 * ⚠️ IMPORTANT: Import from specific modules for better clarity:
 * ```typescript
 * // Preferred - explicit module imports
 * import { Outflow, OutflowStatus } from '../outflow_main/types';
 * import { OutflowPeriod, PaymentType } from '../outflow_periods/types';
 *
 * // Still works - backward compatible
 * import { Outflow, OutflowPeriod } from '../types';
 * ```
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
// Re-export all types from outflow_main module
__exportStar(require("../outflow_main/types"), exports);
// Re-export all types from outflow_periods module
__exportStar(require("../outflow_periods/types"), exports);
// Re-export all types from outflow_summaries module (when available)
// export * from '../outflow_summaries/types';
//# sourceMappingURL=index.js.map