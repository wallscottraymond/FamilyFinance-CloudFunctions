"use strict";
/**
 * Outflows API Functions Module
 *
 * Exports all public-facing API functions for outflows
 *
 * NOTE: Period-related functions have been moved to outflow_periods/api/
 * These re-exports maintain backward compatibility.
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
// Outflow main CRUD operations
__exportStar(require("./crud"), exports);
// Outflow periods API (re-exported for backward compatibility)
__exportStar(require("../outflow_periods/api"), exports);
//# sourceMappingURL=index.js.map