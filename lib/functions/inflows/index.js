"use strict";
/**
 * Inflows Module - Cloud Functions
 *
 * This module provides inflow (recurring income) management for the Family Finance app,
 * including automatic inflow period generation and orchestration.
 *
 * Functions included:
 * - onInflowCreated: Automatic inflow period generation trigger
 *
 * Architecture:
 * - orchestration/triggers: Firestore triggers (Inflow period generation)
 * - utils: Shared utilities for inflow processing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onInflowCreated = void 0;
// ===== Orchestration Functions =====
// Triggers
var onInflowCreated_1 = require("./orchestration/triggers/onInflowCreated");
Object.defineProperty(exports, "onInflowCreated", { enumerable: true, get: function () { return onInflowCreated_1.onInflowCreated; } });
/**
 * Function Overview:
 *
 * onInflowCreated:
 * - Purpose: Automatically generate inflow_periods when inflow is created
 * - Triggers: When document created in inflows collection
 * - Memory: 512MiB, Timeout: 60s
 * - Location: orchestration/triggers/onInflowCreated.ts
 */
//# sourceMappingURL=index.js.map