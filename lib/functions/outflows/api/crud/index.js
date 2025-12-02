"use strict";
/**
 * Outflows CRUD Operations
 *
 * Exports all Create, Read, Update, Delete operations for outflows
 *
 * NOTE: Functions have been moved to their respective module directories:
 * - createManualOutflow → outflow_main/crud/
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
exports.createRecurringOutflow = void 0;
// Re-export from outflow_main module
__exportStar(require("../../outflow_main/crud/createManualOutflow"), exports);
// Backward compatibility alias - deprecated, use createManualOutflow instead
var createManualOutflow_1 = require("../../outflow_main/crud/createManualOutflow");
Object.defineProperty(exports, "createRecurringOutflow", { enumerable: true, get: function () { return createManualOutflow_1.createManualOutflow; } });
//# sourceMappingURL=index.js.map