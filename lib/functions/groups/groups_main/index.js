"use strict";
/**
 * Groups Main Module
 *
 * Core group management functionality including:
 * - Group creation and management
 * - Member management
 * - Group settings and configuration
 * - Group-level triggers and automation
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
// === CRUD Operations ===
// export * from './crud';
// === API Endpoints ===
// export * from './api';
// === Admin Functions ===
// export * from './admin';
// === Triggers ===
// export * from './triggers';
// === Development/Testing Functions ===
// export * from './dev';
// === Types ===
__exportStar(require("./types"), exports);
// === Utilities ===
__exportStar(require("./utils"), exports);
//# sourceMappingURL=index.js.map